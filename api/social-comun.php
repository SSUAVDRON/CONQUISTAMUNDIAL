<?php
// Piezas de la parte social de Trinchera (amigos, invitaciones y clanes): las
// tablas, la ficha pública de cada cuenta y lo que hay que borrar al cerrar
// una cuenta. Lo usan social.php y cuentas.php. No se sirve solo (api/.htaccess).
declare(strict_types=1);

const FICHA_MAX = 1500;            // bytes de la ficha pública en JSON
const CODIGO_LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CLAN_MAX_MIEMBROS = 30;
const AMIGOS_MAX = 200;
const ENVIADAS_MAX = 50;
const INVITACION_SEG = 600;        // una invitación a sala dura 10 minutos
const EN_LINEA_SEG = 180;          // visto hace menos de 3 minutos: en línea

/** Tablas sociales (se crean la primera vez). */
function preparar_social(PDO $pdo): void {
    $mysql = es_mysql($pdo);
    $id = $mysql ? 'BIGINT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $cs = $mysql ? ' DEFAULT CHARSET=utf8mb4' : '';
    $txt = $mysql ? 'MEDIUMTEXT' : 'TEXT';
    // MySQL quiere los índices dentro del CREATE TABLE; SQLite, aparte
    $idx = fn(string $nombre, string $col) => $mysql ? ", INDEX $nombre ($col)" : '';
    $pdo->exec("CREATE TABLE IF NOT EXISTS publicos (
        cuenta_id BIGINT PRIMARY KEY,
        codigo CHAR(8) NOT NULL UNIQUE,
        nombre VARCHAR(40) NOT NULL,
        busca VARCHAR(40) NOT NULL,
        datos $txt NOT NULL,
        estado VARCHAR(12) NOT NULL,
        visto BIGINT NOT NULL,
        actualizado BIGINT NOT NULL" . $idx('publicos_busca', 'busca') . "
    )$cs");
    $pdo->exec("CREATE TABLE IF NOT EXISTS amistades (
        a BIGINT NOT NULL,
        b BIGINT NOT NULL,
        estado INT NOT NULL,
        creado BIGINT NOT NULL,
        PRIMARY KEY (a, b)" . $idx('amistades_b', 'b') . "
    )$cs");
    $pdo->exec("CREATE TABLE IF NOT EXISTS invitaciones (
        id $id,
        de BIGINT NOT NULL,
        para BIGINT NOT NULL,
        sala VARCHAR(8) NOT NULL,
        red VARCHAR(24) NOT NULL,
        creado BIGINT NOT NULL" . $idx('invitaciones_para', 'para') . "
    )$cs");
    $pdo->exec("CREATE TABLE IF NOT EXISTS clanes (
        id $id,
        nombre VARCHAR(30) NOT NULL,
        nombre_busca VARCHAR(30) NOT NULL UNIQUE,
        tag VARCHAR(5) NOT NULL UNIQUE,
        descripcion VARCHAR(200) NOT NULL,
        insignia VARCHAR(400) NOT NULL,
        abierto INT NOT NULL,
        creado BIGINT NOT NULL
    )$cs");
    $pdo->exec("CREATE TABLE IF NOT EXISTS clan_miembros (
        cuenta_id BIGINT PRIMARY KEY,
        clan_id BIGINT NOT NULL,
        rol VARCHAR(8) NOT NULL,
        unido BIGINT NOT NULL" . $idx('clan_miembros_clan', 'clan_id') . "
    )$cs");
    $pdo->exec("CREATE TABLE IF NOT EXISTS clan_solicitudes (
        clan_id BIGINT NOT NULL,
        cuenta_id BIGINT NOT NULL,
        creado BIGINT NOT NULL,
        PRIMARY KEY (clan_id, cuenta_id)
    )$cs");
    if (!$mysql) {
        $pdo->exec('CREATE INDEX IF NOT EXISTS publicos_busca ON publicos (busca)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS amistades_b ON amistades (b)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS invitaciones_para ON invitaciones (para)');
        $pdo->exec('CREATE INDEX IF NOT EXISTS clan_miembros_clan ON clan_miembros (clan_id)');
    }
}

/** Identificador corto de un catálogo (forma, símbolo, marco…). */
function id_corto($v, string $def = ''): string {
    return is_string($v) && preg_match('/^[a-z0-9-]{1,24}$/', $v) ? $v : $def;
}

function color_hex($v, string $def): string {
    return is_string($v) && preg_match('/^#[0-9a-fA-F]{6}$/', $v) ? strtolower($v) : $def;
}

function entero($v, int $min, int $max, int $def = 0): int {
    return is_int($v) || (is_float($v) && is_finite($v)) ? max($min, min($max, (int) $v)) : $def;
}

/** Emblema (o insignia de clan) limpio: forma, símbolo, colores y bandera. */
function emblema_limpio($e): array {
    $e = is_array($e) ? $e : [];
    $out = [
        'shape' => id_corto($e['shape'] ?? null, 'escudo'),
        'symbol' => id_corto($e['symbol'] ?? null, 'estrella'),
        'bg' => color_hex($e['bg'] ?? null, '#2f7dff'),
        'fg' => color_hex($e['fg'] ?? null, '#ffffff'),
    ];
    if (isset($e['flag']) && is_string($e['flag']) && preg_match('/^[a-z]{2,3}(-[a-z]{2,4})?$/i', $e['flag'])) $out['flag'] = strtolower($e['flag']);
    return $out;
}

/**
 * Ficha pública que manda el cliente (lo que ven tus amigos y tu clan): solo
 * campos conocidos, recortados. Nada privado (ni correo ni monedas). Sin
 * nombre, «Jugador»: nunca el de la cuenta, que puede salir del correo.
 */
function ficha_limpia($f): array {
    $f = is_array($f) ? $f : [];
    $nombre = texto($f['nombre'] ?? '', 18) ?: 'Jugador';
    $out = [
        'nombre' => $nombre,
        'nivel' => entero($f['nivel'] ?? 1, 1, 999, 1),
        'titulo' => texto($f['titulo'] ?? '', 24),
        'emblema' => emblema_limpio($f['emblema'] ?? null),
        'marco' => id_corto($f['marco'] ?? null, 'ninguno'),
        'estandarte' => id_corto($f['estandarte'] ?? null, 'noche'),
        'colorNombre' => id_corto($f['colorNombre'] ?? null, 'oro'),
        'victorias' => entero($f['victorias'] ?? 0, 0, 10000000),
        'partidas' => entero($f['partidas'] ?? 0, 0, 10000000),
        'mejor' => is_numeric($f['mejor'] ?? null) ? round(max(0, min(1, (float) $f['mejor'])), 4) : 0,
    ];
    if (is_array($f['liga'] ?? null)) {
        $out['liga'] = ['nombre' => texto($f['liga']['nombre'] ?? '', 24), 'pl' => entero($f['liga']['pl'] ?? 0, 0, 100000)];
    }
    return $out;
}

function nuevo_codigo(): string {
    $s = '';
    for ($i = 0; $i < 8; $i++) $s .= CODIGO_LETRAS[random_int(0, strlen(CODIGO_LETRAS) - 1)];
    return $s;
}

/** Normaliza un código de amigo («abcd-2345» → «ABCD2345»), o '' si no lo parece. */
function codigo_de($v): string {
    $s = strtoupper(preg_replace('/[^0-9A-Za-z]/', '', is_string($v) ? $v : '') ?? '');
    return preg_match('/^[' . CODIGO_LETRAS . ']{8}$/', $s) ? $s : '';
}

/** La fila pública de la cuenta (la crea con su nombre si no tiene). */
function publico_de(PDO $pdo, array $cuenta): array {
    $st = $pdo->prepare('SELECT codigo, nombre, datos, estado, visto FROM publicos WHERE cuenta_id = ?');
    $st->execute([$cuenta['id']]);
    $f = una($st);
    if ($f) return $f;
    $ficha = ficha_limpia([]);
    for ($i = 0; $i < 5; $i++) {
        $codigo = nuevo_codigo();
        try {
            $pdo->prepare('INSERT INTO publicos (cuenta_id, codigo, nombre, busca, datos, estado, visto, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$cuenta['id'], $codigo, $ficha['nombre'], mb_strtolower($ficha['nombre']), json_encode($ficha, JSON_UNESCAPED_UNICODE), 'menu', time(), time()]);
            return ['codigo' => $codigo, 'nombre' => $ficha['nombre'], 'datos' => json_encode($ficha), 'estado' => 'menu', 'visto' => time()];
        } catch (Throwable $e) {
            // Código repetido (muy raro) o fila creada a la vez: otra vuelta
            $st->execute([$cuenta['id']]);
            $f = una($st);
            if ($f) return $f;
        }
    }
    responder(500, ['error' => 'No se ha podido crear tu ficha.']);
}

/** Datos públicos de varias cuentas a la vez: id → { codigo, nombre, ficha, estado, visto, clan }. */
function fichas_de(PDO $pdo, array $ids): array {
    $ids = array_values(array_unique(array_map('intval', $ids)));
    if (!$ids) return [];
    $marcas = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare("SELECT p.cuenta_id, p.codigo, p.nombre, p.datos, p.estado, p.visto, c.tag, c.id AS clan_id
        FROM publicos p LEFT JOIN clan_miembros m ON m.cuenta_id = p.cuenta_id LEFT JOIN clanes c ON c.id = m.clan_id
        WHERE p.cuenta_id IN ($marcas)");
    $st->execute($ids);
    $out = [];
    $ahora = time();
    foreach ($st->fetchAll() as $f) {
        $visto = (int) $f['visto'];
        $out[(int) $f['cuenta_id']] = [
            'id' => (int) $f['cuenta_id'],
            'codigo' => $f['codigo'],
            'nombre' => $f['nombre'],
            'ficha' => json_decode($f['datos'], true) ?: [],
            'estado' => $ahora - $visto <= EN_LINEA_SEG ? $f['estado'] : 'fuera',
            'visto' => $visto,
            'clan' => $f['tag'] ? ['id' => (int) $f['clan_id'], 'tag' => $f['tag']] : null,
        ];
    }
    return $out;
}

/** El clan de la cuenta: [clan_id, rol] o null. */
function clan_de(PDO $pdo, int $cuentaId): ?array {
    $st = $pdo->prepare('SELECT clan_id, rol FROM clan_miembros WHERE cuenta_id = ?');
    $st->execute([$cuentaId]);
    $f = una($st);
    return $f ? ['id' => (int) $f['clan_id'], 'rol' => $f['rol']] : null;
}

/**
 * La cuenta deja su clan. Si era el líder y quedan miembros, el liderazgo
 * pasa al oficial más antiguo (o, si no hay, al miembro más antiguo); si
 * no queda nadie, el clan se disuelve.
 */
function salir_del_clan(PDO $pdo, int $cuentaId): void {
    $mio = clan_de($pdo, $cuentaId);
    if (!$mio) return;
    $pdo->prepare('DELETE FROM clan_miembros WHERE cuenta_id = ?')->execute([$cuentaId]);
    if ($mio['rol'] !== 'lider') return;
    $st = $pdo->prepare("SELECT cuenta_id FROM clan_miembros WHERE clan_id = ? ORDER BY CASE rol WHEN 'oficial' THEN 0 ELSE 1 END, unido ASC, cuenta_id ASC LIMIT 1");
    $st->execute([$mio['id']]);
    $f = una($st);
    if ($f) {
        $pdo->prepare("UPDATE clan_miembros SET rol = 'lider' WHERE cuenta_id = ?")->execute([(int) $f['cuenta_id']]);
    } else {
        $pdo->prepare('DELETE FROM clan_solicitudes WHERE clan_id = ?')->execute([$mio['id']]);
        $pdo->prepare('DELETE FROM clanes WHERE id = ?')->execute([$mio['id']]);
    }
}

/** Al borrar una cuenta: fuera de su clan, sin amistades, invitaciones ni ficha. */
function borrar_social(PDO $pdo, int $cuentaId): void {
    salir_del_clan($pdo, $cuentaId);
    $pdo->prepare('DELETE FROM clan_solicitudes WHERE cuenta_id = ?')->execute([$cuentaId]);
    $pdo->prepare('DELETE FROM amistades WHERE a = ? OR b = ?')->execute([$cuentaId, $cuentaId]);
    $pdo->prepare('DELETE FROM invitaciones WHERE de = ? OR para = ?')->execute([$cuentaId, $cuentaId]);
    $pdo->prepare('DELETE FROM publicos WHERE cuenta_id = ?')->execute([$cuentaId]);
}
