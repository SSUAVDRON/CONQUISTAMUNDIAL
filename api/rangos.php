<?php
// Tabla global de rangos de Trinchera (para la web de Hostinger).
//
//   GET  api/rangos.php?temporada=2026-6
//        → { "filas": [ { id, nombre, titulo, color, emblema, puntos, partidas, victorias } ] }
//          los 100 primeros con la colocación terminada, por puntos.
//   POST api/rangos.php   { "id": "<32 hex>", "secreto": "<64 hex>", "fila": { … } }
//        → { "ok": true }  (crea o actualiza tu fila)
//
// Identidad: un id y un secreto aleatorios que crea el navegador. El servidor
// guarda solo el hash del secreto: quien no lo tenga no puede tocar esa fila.
// Límite de escrituras por id y por IP. Los datos se validan (longitudes,
// colores, emblema, puntos plausibles respecto a la fila anterior).
//
// Configuración: `trinchera-config.php` FUERA de public_html (no se puede
// descargar), en la carpeta de tu usuario:
//
//   <?php return [
//     'dsn'  => 'mysql:host=localhost;dbname=uXXXX_trinchera;charset=utf8mb4',
//     'user' => 'uXXXX_trinchera',
//     'pass' => '…',
//     'sal'  => '…una cadena larga al azar…',
//   ];
//
// En pruebas: variable de entorno TRINCHERA_DSN=sqlite:/ruta/rangos.db.

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const MAX_FILAS = 100;
// Una escritura cada 8 s por jugador (en pruebas, TRINCHERA_ESPERA_ID)
define('ESCRITURA_ID_SEG', max(1, (int) (getenv('TRINCHERA_ESPERA_ID') ?: 8)));
const ESCRITURAS_IP_HORA = 120;  // y 120 por hora desde una misma IP
const MAX_PUNTOS = 5000;
const COLOCACION_MAX = 2300;      // puntos con los que se puede salir de la colocación
const PL_MAX_PARTIDA = 60;        // lo más que se mueve el rango en una partida

function responder(int $codigo, array $cuerpo): void {
    http_response_code($codigo);
    echo json_encode($cuerpo, JSON_UNESCAPED_UNICODE);
    exit;
}

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
    responder(503, ['error' => 'La tabla de rangos no está configurada en este servidor.']);
}

function conectar(array $c): PDO {
    try {
        $pdo = new PDO($c['dsn'], $c['user'], $c['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    } catch (Throwable $e) {
        responder(503, ['error' => 'No se puede abrir la base de datos.']);
    }
    $mysql = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
    $pdo->exec('CREATE TABLE IF NOT EXISTS rangos (
        id VARCHAR(32) PRIMARY KEY,
        secreto CHAR(64) NOT NULL,
        temporada VARCHAR(8) NOT NULL,
        nombre VARCHAR(40) NOT NULL,
        titulo VARCHAR(40) NOT NULL DEFAULT \'\',
        color CHAR(7) NOT NULL,
        emblema VARCHAR(255) NOT NULL,
        puntos INT NOT NULL,
        partidas INT NOT NULL,
        victorias INT NOT NULL,
        colocado INT NOT NULL,
        actualizado BIGINT NOT NULL' . ($mysql ? ', INDEX idx_tabla (temporada, colocado, puntos)' : '') . '
    )' . ($mysql ? ' DEFAULT CHARSET=utf8mb4' : ''));
    if (!$mysql) $pdo->exec('CREATE INDEX IF NOT EXISTS idx_tabla ON rangos (temporada, colocado, puntos)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS rangos_limite (
        clave VARCHAR(80) PRIMARY KEY,
        ventana BIGINT NOT NULL,
        n INT NOT NULL
    )');
    return $pdo;
}

function temporada_valida($t): bool {
    return is_string($t) && preg_match('/^\d{4}-[1-6]$/', $t) === 1;
}

function texto($v, int $max): string {
    $s = is_string($v) ? $v : '';
    $s = preg_replace('/[\x00-\x1F\x7F<>]/u', '', $s) ?? '';
    return mb_substr(trim($s), 0, $max);
}

function color($v): string {
    return is_string($v) && preg_match('/^#[0-9a-fA-F]{6}$/', $v) ? strtolower($v) : '#888888';
}

function emblema($e): string {
    $e = is_array($e) ? $e : [];
    $palabra = fn($v, $d) => is_string($v) && preg_match('/^[a-z]{2,12}$/', $v) ? $v : $d;
    $limpio = [
        'shape' => $palabra($e['shape'] ?? null, 'escudo'),
        'symbol' => $palabra($e['symbol'] ?? null, 'estrella'),
        'bg' => color($e['bg'] ?? null),
        'fg' => color($e['fg'] ?? null),
        'flag' => is_string($e['flag'] ?? null) && preg_match('/^[a-z]{2,3}$/', $e['flag']) ? $e['flag'] : '',
    ];
    return json_encode($limpio);
}

function entero($v, int $min, int $max): int {
    return is_numeric($v) ? max($min, min($max, (int) $v)) : $min;
}

/** ¿Han pasado `segundos` desde la última escritura de `clave`? (y la anota) */
function tras_espera(PDO $pdo, string $clave, int $segundos): bool {
    $ahora = time();
    $st = $pdo->prepare('SELECT ventana FROM rangos_limite WHERE clave = ?');
    $st->execute([$clave]);
    $fila = $st->fetch();
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
    $fila = $st->fetch();
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

$c = configuracion();
$pdo = conectar($c);
$metodo = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($metodo === 'GET') {
    $t = $_GET['temporada'] ?? '';
    if (!temporada_valida($t)) responder(400, ['error' => 'Temporada no válida.']);
    $st = $pdo->prepare('SELECT id, nombre, titulo, color, emblema, puntos, partidas, victorias FROM rangos
        WHERE temporada = ? AND colocado = 1 ORDER BY puntos DESC, partidas DESC LIMIT ' . MAX_FILAS);
    $st->execute([$t]);
    $filas = [];
    foreach ($st->fetchAll() as $f) {
        $f['emblema'] = json_decode($f['emblema'], true) ?: [];
        foreach (['puntos', 'partidas', 'victorias'] as $k) $f[$k] = (int) $f[$k];
        // El id público no es el secreto, pero tampoco hace falta entero: basta para marcar «tú»
        $f['id'] = substr(hash('sha256', $f['id']), 0, 16);
        $f['temporada'] = $t;
        $filas[] = $f;
    }
    responder(200, ['filas' => $filas]);
}

if ($metodo !== 'POST') responder(405, ['error' => 'Método no permitido.']);

$cuerpo = json_decode((string) file_get_contents('php://input', false, null, 0, 8192), true);
if (!is_array($cuerpo)) responder(400, ['error' => 'Cuerpo no válido.']);
$id = $cuerpo['id'] ?? '';
$secreto = $cuerpo['secreto'] ?? '';
$fila = $cuerpo['fila'] ?? null;
if (!is_string($id) || !preg_match('/^[0-9a-f]{32}$/', $id)) responder(400, ['error' => 'Id no válido.']);
if (!is_string($secreto) || !preg_match('/^[0-9a-f]{64}$/', $secreto)) responder(400, ['error' => 'Secreto no válido.']);
if (!is_array($fila) || !temporada_valida($fila['temporada'] ?? null)) responder(400, ['error' => 'Fila no válida.']);

$ip = hash('sha256', ($c['sal'] ?? '') . ($_SERVER['REMOTE_ADDR'] ?? ''));
if (!tras_espera($pdo, 'id:' . $id, ESCRITURA_ID_SEG)) responder(429, ['error' => 'Demasiado seguido: inténtalo en unos segundos.']);
if (!dentro_del_limite($pdo, 'ip:' . substr($ip, 0, 40), 3600, ESCRITURAS_IP_HORA)) responder(429, ['error' => 'Demasiadas escrituras desde esta conexión.']);

$hash = hash('sha256', ($c['sal'] ?? '') . $secreto);
$nueva = [
    'temporada' => $fila['temporada'],
    'nombre' => texto($fila['nombre'] ?? '', 18) ?: 'Jugador',
    'titulo' => texto($fila['titulo'] ?? '', 24),
    'color' => color($fila['color'] ?? null),
    'emblema' => emblema($fila['emblema'] ?? null),
    'puntos' => entero($fila['puntos'] ?? 0, 0, MAX_PUNTOS),
    'partidas' => entero($fila['partidas'] ?? 0, 0, 100000),
    'victorias' => entero($fila['victorias'] ?? 0, 0, 100000),
    'colocado' => !empty($fila['colocado']) ? 1 : 0,
];
if ($nueva['victorias'] > $nueva['partidas']) $nueva['victorias'] = $nueva['partidas'];

$pdo->beginTransaction();
$st = $pdo->prepare('SELECT secreto, temporada, puntos, partidas, colocado FROM rangos WHERE id = ?');
$st->execute([$id]);
$vieja = $st->fetch();
if ($vieja) {
    if (!hash_equals($vieja['secreto'], $hash)) {
        $pdo->rollBack();
        responder(403, ['error' => 'Esta fila es de otra persona.']);
    }
    // Plausible: en la misma temporada, el rango no puede moverse más de lo
    // que permiten las partidas jugadas desde la última vez
    if ($vieja['temporada'] === $nueva['temporada']) {
        $jugadas = $nueva['partidas'] - (int) $vieja['partidas'];
        $tope = PL_MAX_PARTIDA * max(0, $jugadas) + ($nueva['colocado'] && !(int) $vieja['colocado'] ? COLOCACION_MAX : 0);
        if ($jugadas < 0 || abs($nueva['puntos'] - (int) $vieja['puntos']) > $tope) {
            $pdo->rollBack();
            responder(422, ['error' => 'El cambio de rango no cuadra con las partidas jugadas.']);
        }
    }
    $pdo->prepare('UPDATE rangos SET temporada = ?, nombre = ?, titulo = ?, color = ?, emblema = ?, puntos = ?, partidas = ?, victorias = ?, colocado = ?, actualizado = ? WHERE id = ?')
        ->execute([$nueva['temporada'], $nueva['nombre'], $nueva['titulo'], $nueva['color'], $nueva['emblema'], $nueva['puntos'], $nueva['partidas'], $nueva['victorias'], $nueva['colocado'], time(), $id]);
} else {
    // Fila nueva: lo más que se puede tener es salir de la colocación y unas cuantas partidas
    if ($nueva['puntos'] > COLOCACION_MAX + PL_MAX_PARTIDA * max(0, $nueva['partidas'])) {
        $pdo->rollBack();
        responder(422, ['error' => 'El rango no cuadra con las partidas jugadas.']);
    }
    $pdo->prepare('INSERT INTO rangos (id, secreto, temporada, nombre, titulo, color, emblema, puntos, partidas, victorias, colocado, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$id, $hash, $nueva['temporada'], $nueva['nombre'], $nueva['titulo'], $nueva['color'], $nueva['emblema'], $nueva['puntos'], $nueva['partidas'], $nueva['victorias'], $nueva['colocado'], time()]);
}
$pdo->commit();
responder(200, ['ok' => true, 'id' => substr(hash('sha256', $id), 0, 16)]);
