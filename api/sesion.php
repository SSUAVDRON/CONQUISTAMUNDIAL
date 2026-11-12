<?php
// Cuentas y sesiones de Trinchera: las tablas de las cuentas y cómo se
// comprueba un token. Lo usan cuentas.php y social.php. No se sirve solo
// (api/.htaccess lo bloquea).
declare(strict_types=1);

const SESION_DIAS = 180;               // sin usarla, caduca

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
