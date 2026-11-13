<?php
// Piezas comunes de la API de Trinchera (rangos.php y cuentas.php): dónde está
// la base de datos, cómo se abre, la respuesta en JSON y los límites de uso.
// No se sirve sola (api/.htaccess la bloquea).
//
// Base de datos: sin configurar nada, una SQLite que se crea sola FUERA de
// public_html (junto a esa carpeta, donde la web no la puede servir):
// trinchera-rangos.sqlite (y trinchera-rangos-prueba.sqlite para …/prueba/).
// Para MySQL: `trinchera-config.php` fuera de public_html (ver rangos.php).
// En pruebas: variable de entorno TRINCHERA_DSN=sqlite:/ruta/base.db.

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function responder(int $codigo, array $cuerpo): void {
    http_response_code($codigo);
    echo json_encode($cuerpo, JSON_UNESCAPED_UNICODE);
    exit;
}

// Cualquier fallo sin capturar responde JSON (el cliente siempre lee un
// mensaje): un duplicado por dos peticiones a la vez es un 409, lo demás un 500
set_exception_handler(function (Throwable $e): void {
    if ($e instanceof PDOException && str_starts_with((string) $e->getCode(), '23')) {
        responder(409, ['error' => 'Eso acaba de cambiar: vuelve a intentarlo.']);
    }
    error_log('[trinchera] ' . $e->getMessage());
    responder(500, ['error' => 'Algo ha fallado en el servidor. Inténtalo de nuevo.']);
});

function configuracion(): array {
    $dsn = getenv('TRINCHERA_DSN');
    if ($dsn) {
        return ['dsn' => $dsn, 'user' => null, 'pass' => null, 'sal' => getenv('TRINCHERA_SAL') ?: 'pruebas'];
    }
    foreach ([dirname(__DIR__, 2) . '/trinchera-config.php', dirname(__DIR__, 3) . '/trinchera-config.php'] as $ruta) {
        if (is_file($ruta)) {
            $c = require $ruta;
            if (is_array($c) && !empty($c['dsn'])) return $c + ['user' => null, 'pass' => null, 'sal' => ''];
        }
    }
    // Sin configuración: SQLite fuera de public_html
    $sqlite = ruta_sqlite();
    if ($sqlite && in_array('sqlite', PDO::getAvailableDrivers(), true)) {
        return ['dsn' => 'sqlite:' . $sqlite, 'user' => null, 'pass' => null, 'sal' => sal_local(dirname($sqlite)), 'sqlite' => true];
    }
    responder(503, ['error' => 'El servidor no tiene base de datos configurada.']);
}

/**
 * Dónde guardar la SQLite: en la carpeta que contiene public_html (fuera de
 * la web). Cada despliegue en una subcarpeta (p. ej. …/prueba/) tiene la suya.
 * null si no se encuentra public_html o no se puede escribir allí.
 */
function ruta_sqlite(): ?string {
    $dir = __DIR__;
    $sub = [];
    while ($dir !== dirname($dir)) {
        if (basename($dir) === 'public_html') {
            $fuera = dirname($dir);
            if (!is_writable($fuera)) return null;
            array_shift($sub); // la carpeta «api»
            $sufijo = $sub ? '-' . preg_replace('/[^a-z0-9]+/', '-', strtolower(implode('-', array_reverse($sub)))) : '';
            return $fuera . '/trinchera-rangos' . $sufijo . '.sqlite';
        }
        $sub[] = basename($dir);
        $dir = dirname($dir);
    }
    return null;
}

/** Sal para los hashes (secretos e IP): se crea una vez, junto a la base de datos. */
function sal_local(string $dir): string {
    $ruta = $dir . '/trinchera-rangos.sal';
    $sal = is_file($ruta) ? trim((string) file_get_contents($ruta)) : '';
    if (strlen($sal) < 32) {
        $sal = bin2hex(random_bytes(32));
        @file_put_contents($ruta, $sal, LOCK_EX);
        @chmod($ruta, 0600);
    }
    return $sal;
}

/**
 * SQLite: las transacciones empiezan con BEGIN IMMEDIATE, que toma el cerrojo
 * de escritura al principio y espera (busy_timeout) si otro escribe. Una
 * transacción diferida que lee y después escribe falla al momento («database
 * is locked») si otra petición ha escrito entre medias.
 */
final class BdSqlite extends PDO {
    private bool $enTx = false;
    public function beginTransaction(): bool {
        $this->exec('BEGIN IMMEDIATE');
        return $this->enTx = true;
    }
    public function commit(): bool {
        $this->exec('COMMIT');
        $this->enTx = false;
        return true;
    }
    public function rollBack(): bool {
        $this->exec('ROLLBACK');
        $this->enTx = false;
        return true;
    }
    public function inTransaction(): bool {
        return $this->enTx;
    }
}

/**
 * La primera fila de una consulta (o false), cerrando el cursor: en SQLite un
 * cursor abierto mantiene la lectura y la siguiente escritura fallaría.
 */
function una(PDOStatement $st) {
    $f = $st->fetch();
    $st->closeCursor();
    return $f;
}

function conectar(array $c): PDO {
    try {
        $clase = str_starts_with((string) $c['dsn'], 'sqlite:') ? BdSqlite::class : PDO::class;
        $pdo = new $clase($c['dsn'], $c['user'], $c['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    } catch (Throwable $e) {
        responder(503, ['error' => 'No se puede abrir la base de datos.']);
    }
    $mysql = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
    if (!$mysql) {
        // SQLite: varios lectores a la vez y espera corta si otro escribe
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA busy_timeout = 3000');
    }
    // Límites de uso (de las dos API)
    $pdo->exec('CREATE TABLE IF NOT EXISTS rangos_limite (
        clave VARCHAR(80) PRIMARY KEY,
        ventana BIGINT NOT NULL,
        n INT NOT NULL
    )');
    return $pdo;
}

/** ¿Es MySQL? (si no, SQLite) */
function es_mysql(PDO $pdo): bool {
    return $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
}

/** Cuerpo JSON de la petición (como mucho `max` bytes); 400 si no es un objeto. */
function leer_json(int $max): array {
    $raw = (string) file_get_contents('php://input', false, null, 0, $max + 1);
    if (strlen($raw) > $max) responder(413, ['error' => 'Demasiados datos.']);
    $cuerpo = json_decode($raw, true);
    if (!is_array($cuerpo)) responder(400, ['error' => 'Cuerpo no válido.']);
    return $cuerpo;
}

/** Texto limpio: sin controles ni < >, recortado. */
function texto($v, int $max): string {
    $s = is_string($v) ? $v : '';
    $s = preg_replace('/[\x00-\x1F\x7F<>]/u', '', $s) ?? '';
    return mb_substr(trim($s), 0, $max);
}

/** Hash de la IP (con la sal), para los límites. */
function ip_hash(array $c): string {
    return substr(hash('sha256', ($c['sal'] ?? '') . ($_SERVER['REMOTE_ADDR'] ?? '')), 0, 40);
}

/** ¿Han pasado `segundos` desde la última escritura de `clave`? (y la anota) */
function tras_espera(PDO $pdo, string $clave, int $segundos): bool {
    $ahora = time();
    $st = $pdo->prepare('SELECT ventana FROM rangos_limite WHERE clave = ?');
    $st->execute([$clave]);
    $fila = una($st);
    if ($fila && $ahora - (int) $fila['ventana'] < $segundos) return false;
    if ($fila) $pdo->prepare('UPDATE rangos_limite SET ventana = ?, n = 1 WHERE clave = ?')->execute([$ahora, $clave]);
    else $pdo->prepare('INSERT INTO rangos_limite (clave, ventana, n) VALUES (?, ?, 1)')->execute([$clave, $ahora]);
    return true;
}

/** Cuenta una escritura en la ventana de `clave`; false si se pasa del límite. */
function dentro_del_limite(PDO $pdo, string $clave, int $segundos, int $maximo): bool {
    $ahora = time();
    $ventana = intdiv($ahora, $segundos);
    $st = $pdo->prepare('SELECT ventana, n FROM rangos_limite WHERE clave = ?');
    $st->execute([$clave]);
    $fila = una($st);
    if (!$fila) {
        $pdo->prepare('INSERT INTO rangos_limite (clave, ventana, n) VALUES (?, ?, 1)')->execute([$clave, $ventana]);
        return true;
    }
    if ((int) $fila['ventana'] !== $ventana) {
        $pdo->prepare('UPDATE rangos_limite SET ventana = ?, n = 1 WHERE clave = ?')->execute([$ventana, $clave]);
        return true;
    }
    if ((int) $fila['n'] >= $maximo) return false;
    $pdo->prepare('UPDATE rangos_limite SET n = n + 1 WHERE clave = ?')->execute([$clave]);
    return true;
}

