<?php
// Cuentas de Trinchera (para la web de Hostinger): crear cuenta, entrar con
// correo y contraseña y guardar el perfil entero en el servidor.
//
//   POST api/cuentas.php  { "accion": "…", … }   (siempre JSON; el token va en
//   el cuerpo porque Hostinger quita la cabecera Authorization)
//
//   registro       { email, password, nombre }      → { token, cuenta }
//   entrar         { email, password }              → { token, cuenta }
//   salir          { token }                        → { ok }
//   yo             { token }                        → { cuenta }
//   perfil_leer    { token }                        → { perfil|null, version }
//   perfil_guardar { token, perfil, version }       → { ok, version }
//                  409 { perfil, version } si otro dispositivo guardó antes
//   proveedores    {}                               → { proveedores: [] }
//   borrar_cuenta  { token, password }              → { ok }  (todo lo de la cuenta)
//
// Seguridad: contraseñas con password_hash (bcrypt) y de 8 caracteres como
// mínimo; el token de sesión es aleatorio (32 bytes) y se guarda solo su
// sha-256 con la sal; las sesiones caducan a los 180 días sin uso. Límites
// por IP y por correo para registros y entradas. Perfil de 64 KB como mucho.
//
// Google y Apple: la tabla cuenta_proveedores (proveedor, sujeto → cuenta)
// ya existe; «proveedores» dirá cuáles están activos cuando se configuren.
//
// En pruebas: TRINCHERA_DSN=sqlite:/ruta/base.db (ver comun.php).

declare(strict_types=1);

require __DIR__ . '/comun.php';

const PERFIL_MAX = 65536;              // bytes del perfil en JSON
const SESION_DIAS = 180;               // sin usarla, caduca
const REGISTROS_IP_HORA = 10;
const ENTRADAS_IP_HORA = 60;
const ENTRADAS_CORREO_15MIN = 10;
// Hash de relleno (de una contraseña que nadie tiene) para los correos que no existen
const DUMMY_HASH = '$2y$10$YZkO2steD8kdIz.v/Z9htuMas/IOsQp2FoSaydnQAr3DeoAmh3lLe';
define('GUARDADOS_CUENTA_HORA', max(1, (int) (getenv('TRINCHERA_GUARDADOS_HORA') ?: 240)));

/** Tablas de las cuentas (se crean la primera vez). */
function preparar_cuentas(PDO $pdo): void {
    $mysql = es_mysql($pdo);
    $id = $mysql ? 'BIGINT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $charset = $mysql ? ' DEFAULT CHARSET=utf8mb4' : '';
    $pdo->exec("CREATE TABLE IF NOT EXISTS cuentas (
        id $id,
        email VARCHAR(190) NOT NULL UNIQUE,
        nombre VARCHAR(40) NOT NULL,
        hash VARCHAR(255) NOT NULL,
        creado BIGINT NOT NULL
    )$charset");
    $pdo->exec("CREATE TABLE IF NOT EXISTS cuenta_proveedores (
        proveedor VARCHAR(20) NOT NULL,
        sujeto VARCHAR(190) NOT NULL,
        cuenta_id BIGINT NOT NULL,
        creado BIGINT NOT NULL,
        PRIMARY KEY (proveedor, sujeto)
    )$charset");
    $pdo->exec("CREATE TABLE IF NOT EXISTS sesiones (
        token CHAR(64) PRIMARY KEY,
        cuenta_id BIGINT NOT NULL,
        creado BIGINT NOT NULL,
        usado BIGINT NOT NULL
    )$charset");
    $pdo->exec('CREATE TABLE IF NOT EXISTS perfiles (
        cuenta_id BIGINT PRIMARY KEY,
        perfil ' . ($mysql ? 'MEDIUMTEXT' : 'TEXT') . " NOT NULL,
        version INT NOT NULL,
        actualizado BIGINT NOT NULL
    )$charset");
}

function correo_valido($v): string {
    $e = is_string($v) ? mb_strtolower(trim($v)) : '';
    if (strlen($e) > 190 || !filter_var($e, FILTER_VALIDATE_EMAIL)) responder(400, ['error' => 'Ese correo no parece válido.', 'campo' => 'email']);
    return $e;
}

function contrasena($v, bool $nueva): string {
    $p = is_string($v) ? $v : '';
    if ($nueva && mb_strlen($p) < 8) responder(400, ['error' => 'La contraseña tiene que tener al menos 8 caracteres.', 'campo' => 'password']);
    if (strlen($p) > 200) responder(400, ['error' => 'La contraseña es demasiado larga.', 'campo' => 'password']);
    if ($p === '') responder(400, ['error' => 'Escribe tu contraseña.', 'campo' => 'password']);
    return $p;
}

function hash_token(array $c, string $token): string {
    return hash('sha256', ($c['sal'] ?? '') . 'sesion:' . $token);
}

/** Abre una sesión nueva para la cuenta y devuelve el token (solo lo ve el cliente). */
function nueva_sesion(PDO $pdo, array $c, int $cuentaId): string {
    $token = bin2hex(random_bytes(32));
    $ahora = time();
    $pdo->prepare('INSERT INTO sesiones (token, cuenta_id, creado, usado) VALUES (?, ?, ?, ?)')->execute([hash_token($c, $token), $cuentaId, $ahora, $ahora]);
    // De paso, limpia sesiones caducadas (de vez en cuando)
    if (random_int(0, 19) === 0) $pdo->prepare('DELETE FROM sesiones WHERE usado < ?')->execute([$ahora - SESION_DIAS * 86400]);
    return $token;
}

/** La cuenta del token (o 401). Anota el uso como mucho una vez al día. */
function cuenta_de(PDO $pdo, array $c, $token): array {
    if (!is_string($token) || !preg_match('/^[0-9a-f]{64}$/', $token)) responder(401, ['error' => 'Inicia sesión de nuevo.']);
    $h = hash_token($c, $token);
    $st = $pdo->prepare('SELECT s.usado, c.id, c.email, c.nombre FROM sesiones s JOIN cuentas c ON c.id = s.cuenta_id WHERE s.token = ?');
    $st->execute([$h]);
    $f = $st->fetch();
    $ahora = time();
    if (!$f || (int) $f['usado'] < $ahora - SESION_DIAS * 86400) responder(401, ['error' => 'Tu sesión ha caducado: vuelve a entrar.']);
    if ((int) $f['usado'] < $ahora - 86400) $pdo->prepare('UPDATE sesiones SET usado = ? WHERE token = ?')->execute([$ahora, $h]);
    return ['id' => (int) $f['id'], 'email' => $f['email'], 'nombre' => $f['nombre']];
}

function publica(array $cuenta): array {
    return ['email' => $cuenta['email'], 'nombre' => $cuenta['nombre']];
}

$c = configuracion();
$pdo = conectar($c);
preparar_cuentas($pdo);
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') responder(405, ['error' => 'Método no permitido.']);
$cuerpo = leer_json(PERFIL_MAX + 4096);
$accion = is_string($cuerpo['accion'] ?? null) ? $cuerpo['accion'] : '';
$ip = ip_hash($c);

switch ($accion) {
    case 'proveedores':
        // Google y Apple, cuando estén configurados en el servidor
        responder(200, ['proveedores' => []]);

    case 'registro': {
        $email = correo_valido($cuerpo['email'] ?? null);
        $password = contrasena($cuerpo['password'] ?? null, true);
        $nombre = texto($cuerpo['nombre'] ?? '', 18) ?: texto(explode('@', $email)[0], 18) ?: 'Jugador';
        if (!dentro_del_limite($pdo, 'reg:' . $ip, 3600, REGISTROS_IP_HORA)) responder(429, ['error' => 'Demasiadas cuentas nuevas desde esta conexión. Prueba más tarde.']);
        $st = $pdo->prepare('SELECT id FROM cuentas WHERE email = ?');
        $st->execute([$email]);
        if ($st->fetch()) responder(409, ['error' => 'Ya hay una cuenta con ese correo. ¿Quieres entrar?', 'campo' => 'email']);
        $pdo->beginTransaction();
        try {
            $pdo->prepare('INSERT INTO cuentas (email, nombre, hash, creado) VALUES (?, ?, ?, ?)')
                ->execute([$email, $nombre, password_hash($password, PASSWORD_DEFAULT), time()]);
            $id = (int) $pdo->lastInsertId();
            $token = nueva_sesion($pdo, $c, $id);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            // Dos registros a la vez con el mismo correo: el segundo choca con UNIQUE
            responder(409, ['error' => 'Ya hay una cuenta con ese correo. ¿Quieres entrar?', 'campo' => 'email']);
        }
        responder(200, ['token' => $token, 'cuenta' => ['email' => $email, 'nombre' => $nombre]]);
    }

    case 'entrar': {
        $email = correo_valido($cuerpo['email'] ?? null);
        $password = contrasena($cuerpo['password'] ?? null, false);
        if (!dentro_del_limite($pdo, 'ent:' . $ip, 3600, ENTRADAS_IP_HORA)) responder(429, ['error' => 'Demasiados intentos desde esta conexión. Prueba más tarde.']);
        if (!dentro_del_limite($pdo, 'entc:' . substr(hash('sha256', $email), 0, 40), 900, ENTRADAS_CORREO_15MIN)) responder(429, ['error' => 'Demasiados intentos con este correo. Espera unos minutos.']);
        $st = $pdo->prepare('SELECT id, email, nombre, hash FROM cuentas WHERE email = ?');
        $st->execute([$email]);
        $f = $st->fetch();
        // Mismo trabajo si el correo no existe (no se distingue por el tiempo)
        $ok = password_verify($password, $f ? $f['hash'] : DUMMY_HASH);
        if (!$f || !$ok) responder(401, ['error' => 'Correo o contraseña incorrectos.']);
        if (password_needs_rehash($f['hash'], PASSWORD_DEFAULT)) {
            $pdo->prepare('UPDATE cuentas SET hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $f['id']]);
        }
        $token = nueva_sesion($pdo, $c, (int) $f['id']);
        responder(200, ['token' => $token, 'cuenta' => publica($f)]);
    }

    case 'salir': {
        $token = $cuerpo['token'] ?? '';
        if (is_string($token) && preg_match('/^[0-9a-f]{64}$/', $token)) {
            $pdo->prepare('DELETE FROM sesiones WHERE token = ?')->execute([hash_token($c, $token)]);
        }
        responder(200, ['ok' => true]);
    }

    case 'yo':
        responder(200, ['cuenta' => publica(cuenta_de($pdo, $c, $cuerpo['token'] ?? null))]);

    case 'perfil_leer': {
        $cuenta = cuenta_de($pdo, $c, $cuerpo['token'] ?? null);
        $st = $pdo->prepare('SELECT perfil, version FROM perfiles WHERE cuenta_id = ?');
        $st->execute([$cuenta['id']]);
        $f = $st->fetch();
        responder(200, ['perfil' => $f ? json_decode($f['perfil'], true) : null, 'version' => $f ? (int) $f['version'] : 0, 'cuenta' => publica($cuenta)]);
    }

    case 'perfil_guardar': {
        $cuenta = cuenta_de($pdo, $c, $cuerpo['token'] ?? null);
        $perfil = $cuerpo['perfil'] ?? null;
        $version = $cuerpo['version'] ?? null;
        if (!is_array($perfil) || !is_int($version) || $version < 0) responder(400, ['error' => 'Perfil no válido.']);
        $json = json_encode($perfil, JSON_UNESCAPED_UNICODE);
        if ($json === false || strlen($json) > PERFIL_MAX) responder(413, ['error' => 'El perfil es demasiado grande.']);
        if (!dentro_del_limite($pdo, 'perfil:' . $cuenta['id'], 3600, GUARDADOS_CUENTA_HORA)) responder(429, ['error' => 'Demasiados guardados seguidos: se guardará en un rato.']);
        $pdo->beginTransaction();
        $st = $pdo->prepare('SELECT perfil, version FROM perfiles WHERE cuenta_id = ?');
        $st->execute([$cuenta['id']]);
        $f = $st->fetch();
        $actual = $f ? (int) $f['version'] : 0;
        if ($actual !== $version) {
            // Otro dispositivo guardó antes: el cliente une los dos y vuelve a guardar
            $pdo->rollBack();
            responder(409, ['error' => 'El perfil cambió en otro dispositivo.', 'perfil' => $f ? json_decode($f['perfil'], true) : null, 'version' => $actual]);
        }
        if ($f) {
            $pdo->prepare('UPDATE perfiles SET perfil = ?, version = ?, actualizado = ? WHERE cuenta_id = ? AND version = ?')
                ->execute([$json, $actual + 1, time(), $cuenta['id'], $actual]);
        } else {
            $pdo->prepare('INSERT INTO perfiles (cuenta_id, perfil, version, actualizado) VALUES (?, ?, ?, ?)')
                ->execute([$cuenta['id'], $json, 1, time()]);
        }
        $pdo->commit();
        responder(200, ['ok' => true, 'version' => $actual + 1]);
    }

    case 'borrar_cuenta': {
        // Borra la cuenta y todo lo suyo; pide otra vez la contraseña
        $cuenta = cuenta_de($pdo, $c, $cuerpo['token'] ?? null);
        $password = contrasena($cuerpo['password'] ?? null, false);
        if (!dentro_del_limite($pdo, 'ent:' . $ip, 3600, ENTRADAS_IP_HORA)) responder(429, ['error' => 'Demasiados intentos desde esta conexión. Prueba más tarde.']);
        $st = $pdo->prepare('SELECT hash FROM cuentas WHERE id = ?');
        $st->execute([$cuenta['id']]);
        $f = $st->fetch();
        if (!$f || !password_verify($password, $f['hash'])) responder(401, ['error' => 'La contraseña no es correcta.', 'campo' => 'password']);
        $pdo->beginTransaction();
        foreach (['perfiles', 'sesiones', 'cuenta_proveedores'] as $tabla) $pdo->prepare("DELETE FROM $tabla WHERE cuenta_id = ?")->execute([$cuenta['id']]);
        $pdo->prepare('DELETE FROM cuentas WHERE id = ?')->execute([$cuenta['id']]);
        $pdo->commit();
        responder(200, ['ok' => true]);
    }

    default:
        responder(400, ['error' => 'Acción desconocida.']);
}
