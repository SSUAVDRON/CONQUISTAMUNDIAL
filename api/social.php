<?php
// Amigos, invitaciones a sala y clanes de Trinchera (para la web de
// Hostinger). Todo pide sesión (el token de cuentas.php).
//
//   POST api/social.php  { "accion": "…", "token": "…", … }
//
//   ficha_guardar     { ficha }                    → { codigo }  tu ficha pública (lo que ven los demás)
//   social            { estado? }                  → { yo, amigos, recibidas, enviadas, invitaciones, clan, ahora }
//                       estado: «menu», «sala» o «partida» (y te marca en línea)
//   buscar            { texto }                    → { jugadores }  por nombre (2+ letras) o código
//   amigo_solicitar   { codigo }                   → { ok, estado: «enviada»|«amigos» }
//   amigo_responder   { id, aceptar }              → { ok }
//   amigo_quitar      { id }                       → { ok }  (también cancela o rechaza)
//   invitar           { id, sala, red }            → { ok }  a un amigo, a tu sala
//   invitacion_borrar { id }                       → { ok }
//   clanes            { texto? }                   → { clanes }  los mejores, o los que coinciden
//   clan_ver          { id }                       → { clan, miembros, solicitudes?, pedido }
//   clan_crear        { nombre, tag, descripcion, insignia, abierto } → { clan }
//   clan_unirse       { id }                       → { ok, estado: «dentro»|«pedido» }
//   clan_cancelar     { id }                       → { ok }
//   clan_responder    { cuenta, aceptar }          → { ok }  (líder u oficial)
//   clan_salir        {}                           → { ok }
//   clan_expulsar     { cuenta }                   → { ok }  (líder, u oficial a un miembro)
//   clan_rol          { cuenta, rol }              → { ok }  (líder: oficial, miembro o pasar el liderazgo)
//   clan_editar       { descripcion, insignia, abierto } → { ok }  (líder u oficial)
//
// Privacidad: los demás solo ven la ficha pública (nombre de tu nación,
// nivel, título, emblema, victorias, liga…), tu código de amigo y si estás
// en línea; nunca el correo. Límites de uso por cuenta.

declare(strict_types=1);

require __DIR__ . '/comun.php';
require __DIR__ . '/sesion.php';
require __DIR__ . '/social-comun.php';

$c = configuracion();
$pdo = conectar($c);
preparar_cuentas($pdo);
preparar_social($pdo);
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') responder(405, ['error' => 'Método no permitido.']);
$cuerpo = leer_json(8192);
$accion = is_string($cuerpo['accion'] ?? null) ? $cuerpo['accion'] : '';
$cuenta = cuenta_de($pdo, $c, $cuerpo['token'] ?? null);
$yo = $cuenta['id'];
$ahora = time();

/** Límite por cuenta (o 429). */
function limite(PDO $pdo, string $clave, int $seg, int $max, string $msg = 'Vas muy rápido: espera un poco.'): void {
    if (!dentro_del_limite($pdo, $clave, $seg, $max)) responder(429, ['error' => $msg]);
}

/** Estado entre dos cuentas: 'amigos', 'enviada' (yo pedí), 'recibida' (me pidió) o ''. */
function relacion(PDO $pdo, int $yo, int $otro): string {
    $st = $pdo->prepare('SELECT a, estado FROM amistades WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)');
    $st->execute([$yo, $otro, $otro, $yo]);
    $f = $st->fetch();
    if (!$f) return '';
    if ((int) $f['estado'] === 1) return 'amigos';
    return (int) $f['a'] === $yo ? 'enviada' : 'recibida';
}

/** Resumen de un clan: datos, cuántos son y lo que suman. */
function resumen_clan(PDO $pdo, array $f): array {
    $st = $pdo->prepare('SELECT p.datos FROM clan_miembros m LEFT JOIN publicos p ON p.cuenta_id = m.cuenta_id WHERE m.clan_id = ?');
    $st->execute([(int) $f['id']]);
    $n = 0;
    $victorias = 0;
    $niveles = 0;
    foreach ($st->fetchAll() as $m) {
        $n++;
        $d = $m['datos'] ? (json_decode($m['datos'], true) ?: []) : [];
        $victorias += (int) ($d['victorias'] ?? 0);
        $niveles += (int) ($d['nivel'] ?? 1);
    }
    return [
        'id' => (int) $f['id'],
        'nombre' => $f['nombre'],
        'tag' => $f['tag'],
        'descripcion' => $f['descripcion'],
        'insignia' => json_decode($f['insignia'], true) ?: [],
        'abierto' => (bool) (int) $f['abierto'],
        'creado' => (int) $f['creado'],
        'miembros' => $n,
        'victorias' => $victorias,
        'nivel' => $niveles,
    ];
}

function clan_fila(PDO $pdo, int $id): ?array {
    $st = $pdo->prepare('SELECT * FROM clanes WHERE id = ?');
    $st->execute([$id]);
    return $st->fetch() ?: null;
}

function miembros_de(PDO $pdo, int $clanId): int {
    $st = $pdo->prepare('SELECT COUNT(*) AS n FROM clan_miembros WHERE clan_id = ?');
    $st->execute([$clanId]);
    return (int) $st->fetch()['n'];
}

/** Mi clan y mi rol, o 403 con `msg`. `roles`: los que valen. */
function mi_clan(PDO $pdo, int $yo, array $roles, string $msg): array {
    $m = clan_de($pdo, $yo);
    if (!$m || !in_array($m['rol'], $roles, true)) responder(403, ['error' => $msg]);
    return $m;
}

function insignia_de($v): string {
    return json_encode(emblema_limpio($v), JSON_UNESCAPED_UNICODE);
}

switch ($accion) {
    case 'ficha_guardar': {
        limite($pdo, "ficha:$yo", 3600, 240);
        $ficha = ficha_limpia($cuerpo['ficha'] ?? null, $cuenta['nombre']);
        $json = json_encode($ficha, JSON_UNESCAPED_UNICODE);
        if (strlen($json) > FICHA_MAX) responder(413, ['error' => 'Ficha demasiado grande.']);
        $pub = publico_de($pdo, $cuenta);
        $pdo->prepare('UPDATE publicos SET nombre = ?, busca = ?, datos = ?, visto = ?, actualizado = ? WHERE cuenta_id = ?')
            ->execute([$ficha['nombre'], mb_strtolower($ficha['nombre']), $json, $ahora, $ahora, $yo]);
        responder(200, ['codigo' => $pub['codigo']]);
    }

    case 'social': {
        limite($pdo, "social:$yo", 3600, 400);
        $pub = publico_de($pdo, $cuenta);
        $estado = in_array($cuerpo['estado'] ?? '', ['menu', 'sala', 'partida'], true) ? $cuerpo['estado'] : 'menu';
        $pdo->prepare('UPDATE publicos SET estado = ?, visto = ? WHERE cuenta_id = ?')->execute([$estado, $ahora, $yo]);
        // Amistades (las aceptadas y las pendientes en los dos sentidos)
        $st = $pdo->prepare('SELECT a, b, estado, creado FROM amistades WHERE a = ? OR b = ?');
        $st->execute([$yo, $yo]);
        $filas = $st->fetchAll();
        // Invitaciones a sala que siguen vivas
        $pdo->prepare('DELETE FROM invitaciones WHERE creado < ?')->execute([$ahora - INVITACION_SEG]);
        $st = $pdo->prepare('SELECT id, de, sala, red, creado FROM invitaciones WHERE para = ? ORDER BY creado DESC LIMIT 10');
        $st->execute([$yo]);
        $inv = $st->fetchAll();
        $ids = [];
        foreach ($filas as $f) $ids[] = (int) $f['a'] === $yo ? (int) $f['b'] : (int) $f['a'];
        foreach ($inv as $i) $ids[] = (int) $i['de'];
        $fichas = fichas_de($pdo, $ids);
        $amigos = $recibidas = $enviadas = [];
        foreach ($filas as $f) {
            $otro = (int) $f['a'] === $yo ? (int) $f['b'] : (int) $f['a'];
            $x = $fichas[$otro] ?? null;
            if (!$x) continue;
            if ((int) $f['estado'] === 1) $amigos[] = $x + ['desde' => (int) $f['creado']];
            elseif ((int) $f['a'] === $yo) $enviadas[] = $x + ['desde' => (int) $f['creado']];
            else $recibidas[] = $x + ['desde' => (int) $f['creado']];
        }
        // En línea primero; luego por nombre
        usort($amigos, fn($p, $q) => [($p['estado'] === 'fuera') ? 1 : 0, mb_strtolower($p['nombre'])] <=> [($q['estado'] === 'fuera') ? 1 : 0, mb_strtolower($q['nombre'])]);
        $invitaciones = [];
        foreach ($inv as $i) {
            $de = $fichas[(int) $i['de']] ?? null;
            if ($de) $invitaciones[] = ['id' => (int) $i['id'], 'de' => $de, 'sala' => $i['sala'], 'red' => $i['red'], 'creado' => (int) $i['creado']];
        }
        // Mi clan
        $clan = null;
        $m = clan_de($pdo, $yo);
        if ($m && ($f = clan_fila($pdo, $m['id']))) {
            $clan = resumen_clan($pdo, $f) + ['rol' => $m['rol']];
            if (in_array($m['rol'], ['lider', 'oficial'], true)) {
                $st = $pdo->prepare('SELECT COUNT(*) AS n FROM clan_solicitudes WHERE clan_id = ?');
                $st->execute([$m['id']]);
                $clan['solicitudes'] = (int) $st->fetch()['n'];
            }
        }
        $st = $pdo->prepare('SELECT clan_id FROM clan_solicitudes WHERE cuenta_id = ?');
        $st->execute([$yo]);
        $pedidos = array_map(fn($f) => (int) $f['clan_id'], $st->fetchAll());
        $ficha = json_decode($pub['datos'], true) ?: [];
        responder(200, [
            'yo' => ['id' => $yo, 'codigo' => $pub['codigo'], 'nombre' => $ficha['nombre'] ?? $cuenta['nombre']],
            'amigos' => $amigos,
            'recibidas' => $recibidas,
            'enviadas' => $enviadas,
            'invitaciones' => $invitaciones,
            'clan' => $clan,
            'pedidos' => $pedidos,
            'ahora' => $ahora,
        ]);
    }

    case 'buscar': {
        limite($pdo, "buscar:$yo", 3600, 120, 'Demasiadas búsquedas seguidas: espera un poco.');
        $texto = texto($cuerpo['texto'] ?? '', 30);
        $codigo = codigo_de($texto);
        if ($codigo) {
            $st = $pdo->prepare('SELECT cuenta_id FROM publicos WHERE codigo = ? AND cuenta_id <> ?');
            $st->execute([$codigo, $yo]);
        } else {
            if (mb_strlen($texto) < 2) responder(200, ['jugadores' => []]);
            $patron = str_replace(['!', '%', '_'], ['!!', '!%', '!_'], mb_strtolower($texto)) . '%';
            $st = $pdo->prepare("SELECT cuenta_id FROM publicos WHERE busca LIKE ? ESCAPE '!' AND cuenta_id <> ? ORDER BY visto DESC LIMIT 12");
            $st->execute([$patron, $yo]);
        }
        $ids = array_map(fn($f) => (int) $f['cuenta_id'], $st->fetchAll());
        $fichas = fichas_de($pdo, $ids);
        $out = [];
        foreach ($ids as $id) {
            if (!isset($fichas[$id])) continue;
            $out[] = $fichas[$id] + ['relacion' => relacion($pdo, $yo, $id)];
        }
        responder(200, ['jugadores' => $out]);
    }

    case 'amigo_solicitar': {
        limite($pdo, "amistad:$yo", 3600, 40, 'Demasiadas solicitudes seguidas: espera un poco.');
        $codigo = codigo_de($cuerpo['codigo'] ?? '');
        if (!$codigo) responder(400, ['error' => 'Ese código no es válido: son 8 letras y números, como ABCD-2345.']);
        $st = $pdo->prepare('SELECT cuenta_id FROM publicos WHERE codigo = ?');
        $st->execute([$codigo]);
        $f = $st->fetch();
        if (!$f) responder(404, ['error' => 'No hay nadie con ese código.']);
        $otro = (int) $f['cuenta_id'];
        if ($otro === $yo) responder(400, ['error' => 'Ese es tu propio código.']);
        $rel = relacion($pdo, $yo, $otro);
        if ($rel === 'amigos') responder(200, ['ok' => true, 'estado' => 'amigos']);
        if ($rel === 'enviada') responder(200, ['ok' => true, 'estado' => 'enviada']);
        if ($rel === 'recibida') {
            // Ya te lo había pedido: sois amigos
            $pdo->prepare('UPDATE amistades SET estado = 1, creado = ? WHERE a = ? AND b = ?')->execute([$ahora, $otro, $yo]);
            responder(200, ['ok' => true, 'estado' => 'amigos']);
        }
        $st = $pdo->prepare('SELECT COUNT(*) AS n FROM amistades WHERE (a = ? OR b = ?) AND estado = 1');
        $st->execute([$yo, $yo]);
        if ((int) $st->fetch()['n'] >= AMIGOS_MAX) responder(409, ['error' => 'Ya tienes ' . AMIGOS_MAX . ' amigos.']);
        $st = $pdo->prepare('SELECT COUNT(*) AS n FROM amistades WHERE a = ? AND estado = 0');
        $st->execute([$yo]);
        if ((int) $st->fetch()['n'] >= ENVIADAS_MAX) responder(409, ['error' => 'Tienes demasiadas solicitudes sin responder.']);
        publico_de($pdo, $cuenta);
        $pdo->prepare('INSERT INTO amistades (a, b, estado, creado) VALUES (?, ?, 0, ?)')->execute([$yo, $otro, $ahora]);
        responder(200, ['ok' => true, 'estado' => 'enviada']);
    }

    case 'amigo_responder': {
        $otro = entero($cuerpo['id'] ?? 0, 0, PHP_INT_MAX);
        if (relacion($pdo, $yo, $otro) !== 'recibida') responder(404, ['error' => 'Esa solicitud ya no existe.']);
        if (!empty($cuerpo['aceptar'])) $pdo->prepare('UPDATE amistades SET estado = 1, creado = ? WHERE a = ? AND b = ?')->execute([$ahora, $otro, $yo]);
        else $pdo->prepare('DELETE FROM amistades WHERE a = ? AND b = ?')->execute([$otro, $yo]);
        responder(200, ['ok' => true]);
    }

    case 'amigo_quitar': {
        $otro = entero($cuerpo['id'] ?? 0, 0, PHP_INT_MAX);
        $pdo->prepare('DELETE FROM amistades WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)')->execute([$yo, $otro, $otro, $yo]);
        $pdo->prepare('DELETE FROM invitaciones WHERE (de = ? AND para = ?) OR (de = ? AND para = ?)')->execute([$yo, $otro, $otro, $yo]);
        responder(200, ['ok' => true]);
    }

    case 'invitar': {
        limite($pdo, "invitar:$yo", 3600, 60, 'Demasiadas invitaciones seguidas: espera un poco.');
        $otro = entero($cuerpo['id'] ?? 0, 0, PHP_INT_MAX);
        $sala = is_string($cuerpo['sala'] ?? null) && preg_match('/^[a-z0-9]{5}$/', $cuerpo['sala']) ? $cuerpo['sala'] : '';
        $red = is_string($cuerpo['red'] ?? null) && preg_match('/^[a-z0-9=&._:-]{0,24}$/i', $cuerpo['red']) ? $cuerpo['red'] : '';
        if (!$sala) responder(400, ['error' => 'Crea una sala antes de invitar.']);
        if (relacion($pdo, $yo, $otro) !== 'amigos') responder(403, ['error' => 'Solo puedes invitar a tus amigos.']);
        $pdo->prepare('DELETE FROM invitaciones WHERE de = ? AND para = ?')->execute([$yo, $otro]);
        $pdo->prepare('INSERT INTO invitaciones (de, para, sala, red, creado) VALUES (?, ?, ?, ?, ?)')->execute([$yo, $otro, $sala, $red, $ahora]);
        responder(200, ['ok' => true]);
    }

    case 'invitacion_borrar': {
        $id = entero($cuerpo['id'] ?? 0, 0, PHP_INT_MAX);
        $pdo->prepare('DELETE FROM invitaciones WHERE id = ? AND para = ?')->execute([$id, $yo]);
        responder(200, ['ok' => true]);
    }

    case 'clanes': {
        limite($pdo, "clanes:$yo", 3600, 120, 'Demasiadas búsquedas seguidas: espera un poco.');
        $texto = texto($cuerpo['texto'] ?? '', 30);
        if (mb_strlen($texto) >= 2) {
            $patron = str_replace(['!', '%', '_'], ['!!', '!%', '!_'], mb_strtolower($texto)) . '%';
            $st = $pdo->prepare("SELECT * FROM clanes WHERE nombre_busca LIKE ? ESCAPE '!' OR LOWER(tag) LIKE ? ESCAPE '!' LIMIT 20");
            $st->execute([$patron, $patron]);
        } else {
            // Los más grandes (por miembros); el orden fino, por victorias, después
            $st = $pdo->query('SELECT c.* FROM clanes c LEFT JOIN clan_miembros m ON m.clan_id = c.id GROUP BY c.id ORDER BY COUNT(m.cuenta_id) DESC, c.id ASC LIMIT 40');
        }
        $lista = array_map(fn($f) => resumen_clan($pdo, $f), $st->fetchAll());
        usort($lista, fn($p, $q) => [$q['victorias'], $q['miembros']] <=> [$p['victorias'], $p['miembros']]);
        responder(200, ['clanes' => array_slice($lista, 0, 20)]);
    }

    case 'clan_ver': {
        $f = clan_fila($pdo, entero($cuerpo['id'] ?? 0, 0, PHP_INT_MAX));
        if (!$f) responder(404, ['error' => 'Ese clan ya no existe.']);
        $clan = resumen_clan($pdo, $f);
        $st = $pdo->prepare('SELECT cuenta_id, rol, unido FROM clan_miembros WHERE clan_id = ?');
        $st->execute([$clan['id']]);
        $filas = $st->fetchAll();
        $fichas = fichas_de($pdo, array_map(fn($x) => (int) $x['cuenta_id'], $filas));
        $orden = ['lider' => 0, 'oficial' => 1, 'miembro' => 2];
        $miembros = [];
        foreach ($filas as $x) {
            $id = (int) $x['cuenta_id'];
            if (!isset($fichas[$id])) continue;
            $miembros[] = $fichas[$id] + ['rol' => $x['rol'], 'unido' => (int) $x['unido']];
        }
        usort($miembros, fn($p, $q) => [$orden[$p['rol']] ?? 3, -($p['ficha']['nivel'] ?? 1)] <=> [$orden[$q['rol']] ?? 3, -($q['ficha']['nivel'] ?? 1)]);
        $mio = clan_de($pdo, $yo);
        $out = ['clan' => $clan, 'miembros' => $miembros, 'rol' => $mio && $mio['id'] === $clan['id'] ? $mio['rol'] : null];
        if ($out['rol'] === 'lider' || $out['rol'] === 'oficial') {
            $st = $pdo->prepare('SELECT cuenta_id, creado FROM clan_solicitudes WHERE clan_id = ? ORDER BY creado ASC LIMIT 50');
            $st->execute([$clan['id']]);
            $sol = $st->fetchAll();
            $fs = fichas_de($pdo, array_map(fn($x) => (int) $x['cuenta_id'], $sol));
            $out['solicitudes'] = array_values(array_filter(array_map(fn($x) => isset($fs[(int) $x['cuenta_id']]) ? $fs[(int) $x['cuenta_id']] + ['desde' => (int) $x['creado']] : null, $sol)));
        }
        $st = $pdo->prepare('SELECT 1 FROM clan_solicitudes WHERE clan_id = ? AND cuenta_id = ?');
        $st->execute([$clan['id'], $yo]);
        $out['pedido'] = (bool) $st->fetch();
        responder(200, $out);
    }

    case 'clan_crear': {
        limite($pdo, "clancrear:$yo", 86400, 5, 'Ya has creado varios clanes hoy: prueba mañana.');
        if (clan_de($pdo, $yo)) responder(409, ['error' => 'Ya estás en un clan: sal de él para crear otro.']);
        $nombre = texto($cuerpo['nombre'] ?? '', 24);
        if (mb_strlen($nombre) < 3) responder(400, ['error' => 'El nombre del clan tiene que tener al menos 3 letras.', 'campo' => 'nombre']);
        $tag = strtoupper(preg_replace('/[^0-9A-Za-z]/', '', is_string($cuerpo['tag'] ?? null) ? $cuerpo['tag'] : '') ?? '');
        if (strlen($tag) < 2 || strlen($tag) > 5) responder(400, ['error' => 'La etiqueta son de 2 a 5 letras o números.', 'campo' => 'tag']);
        $desc = texto($cuerpo['descripcion'] ?? '', 160);
        $abierto = !empty($cuerpo['abierto']) ? 1 : 0;
        $pdo->beginTransaction();
        try {
            $pdo->prepare('INSERT INTO clanes (nombre, nombre_busca, tag, descripcion, insignia, abierto, creado) VALUES (?, ?, ?, ?, ?, ?, ?)')
                ->execute([$nombre, mb_strtolower($nombre), $tag, $desc, insignia_de($cuerpo['insignia'] ?? null), $abierto, $ahora]);
            $id = (int) $pdo->lastInsertId();
            $pdo->prepare("INSERT INTO clan_miembros (cuenta_id, clan_id, rol, unido) VALUES (?, ?, 'lider', ?)")->execute([$yo, $id, $ahora]);
            $pdo->prepare('DELETE FROM clan_solicitudes WHERE cuenta_id = ?')->execute([$yo]);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            $st = $pdo->prepare('SELECT tag, nombre_busca FROM clanes WHERE tag = ? OR nombre_busca = ?');
            $st->execute([$tag, mb_strtolower($nombre)]);
            $dup = $st->fetch();
            if ($dup && $dup['tag'] === $tag) responder(409, ['error' => "La etiqueta [$tag] ya es de otro clan.", 'campo' => 'tag']);
            if ($dup) responder(409, ['error' => 'Ya hay un clan con ese nombre.', 'campo' => 'nombre']);
            responder(409, ['error' => 'No se ha podido crear el clan: inténtalo de nuevo.']);
        }
        publico_de($pdo, $cuenta);
        responder(200, ['clan' => resumen_clan($pdo, clan_fila($pdo, $id))]);
    }

    case 'clan_unirse': {
        limite($pdo, "clan:$yo", 3600, 60);
        $f = clan_fila($pdo, entero($cuerpo['id'] ?? 0, 0, PHP_INT_MAX));
        if (!$f) responder(404, ['error' => 'Ese clan ya no existe.']);
        if (clan_de($pdo, $yo)) responder(409, ['error' => 'Ya estás en un clan: sal de él antes.']);
        if (miembros_de($pdo, (int) $f['id']) >= CLAN_MAX_MIEMBROS) responder(409, ['error' => 'Ese clan está lleno (' . CLAN_MAX_MIEMBROS . ' miembros).']);
        publico_de($pdo, $cuenta);
        if ((int) $f['abierto']) {
            $pdo->prepare("INSERT INTO clan_miembros (cuenta_id, clan_id, rol, unido) VALUES (?, ?, 'miembro', ?)")->execute([$yo, (int) $f['id'], $ahora]);
            $pdo->prepare('DELETE FROM clan_solicitudes WHERE cuenta_id = ?')->execute([$yo]);
            responder(200, ['ok' => true, 'estado' => 'dentro']);
        }
        $st = $pdo->prepare('SELECT COUNT(*) AS n FROM clan_solicitudes WHERE cuenta_id = ?');
        $st->execute([$yo]);
        if ((int) $st->fetch()['n'] >= 5) responder(409, ['error' => 'Ya has pedido entrar en 5 clanes: espera a que te respondan.']);
        $st = $pdo->prepare('SELECT 1 FROM clan_solicitudes WHERE clan_id = ? AND cuenta_id = ?');
        $st->execute([(int) $f['id'], $yo]);
        if (!$st->fetch()) $pdo->prepare('INSERT INTO clan_solicitudes (clan_id, cuenta_id, creado) VALUES (?, ?, ?)')->execute([(int) $f['id'], $yo, $ahora]);
        responder(200, ['ok' => true, 'estado' => 'pedido']);
    }

    case 'clan_cancelar': {
        $pdo->prepare('DELETE FROM clan_solicitudes WHERE clan_id = ? AND cuenta_id = ?')->execute([entero($cuerpo['id'] ?? 0, 0, PHP_INT_MAX), $yo]);
        responder(200, ['ok' => true]);
    }

    case 'clan_responder': {
        $m = mi_clan($pdo, $yo, ['lider', 'oficial'], 'Solo el líder y los oficiales aceptan solicitudes.');
        $otro = entero($cuerpo['cuenta'] ?? 0, 0, PHP_INT_MAX);
        $st = $pdo->prepare('SELECT 1 FROM clan_solicitudes WHERE clan_id = ? AND cuenta_id = ?');
        $st->execute([$m['id'], $otro]);
        if (!$st->fetch()) responder(404, ['error' => 'Esa solicitud ya no existe.']);
        if (!empty($cuerpo['aceptar'])) {
            if (clan_de($pdo, $otro)) {
                $pdo->prepare('DELETE FROM clan_solicitudes WHERE cuenta_id = ?')->execute([$otro]);
                responder(409, ['error' => 'Ya se ha unido a otro clan.']);
            }
            if (miembros_de($pdo, $m['id']) >= CLAN_MAX_MIEMBROS) responder(409, ['error' => 'El clan está lleno.']);
            $pdo->prepare("INSERT INTO clan_miembros (cuenta_id, clan_id, rol, unido) VALUES (?, ?, 'miembro', ?)")->execute([$otro, $m['id'], $ahora]);
            $pdo->prepare('DELETE FROM clan_solicitudes WHERE cuenta_id = ?')->execute([$otro]);
        } else {
            $pdo->prepare('DELETE FROM clan_solicitudes WHERE clan_id = ? AND cuenta_id = ?')->execute([$m['id'], $otro]);
        }
        responder(200, ['ok' => true]);
    }

    case 'clan_salir': {
        $pdo->beginTransaction();
        salir_del_clan($pdo, $yo);
        $pdo->commit();
        responder(200, ['ok' => true]);
    }

    case 'clan_expulsar': {
        $m = mi_clan($pdo, $yo, ['lider', 'oficial'], 'Solo el líder y los oficiales pueden expulsar.');
        $otro = entero($cuerpo['cuenta'] ?? 0, 0, PHP_INT_MAX);
        $suyo = clan_de($pdo, $otro);
        if ($otro === $yo || !$suyo || $suyo['id'] !== $m['id']) responder(404, ['error' => 'No está en tu clan.']);
        if ($suyo['rol'] === 'lider' || ($m['rol'] === 'oficial' && $suyo['rol'] !== 'miembro')) responder(403, ['error' => 'No puedes expulsar a alguien de tu rango o superior.']);
        $pdo->prepare('DELETE FROM clan_miembros WHERE cuenta_id = ?')->execute([$otro]);
        responder(200, ['ok' => true]);
    }

    case 'clan_rol': {
        $m = mi_clan($pdo, $yo, ['lider'], 'Solo el líder cambia los rangos.');
        $otro = entero($cuerpo['cuenta'] ?? 0, 0, PHP_INT_MAX);
        $rol = in_array($cuerpo['rol'] ?? '', ['lider', 'oficial', 'miembro'], true) ? $cuerpo['rol'] : '';
        $suyo = clan_de($pdo, $otro);
        if (!$rol || $otro === $yo || !$suyo || $suyo['id'] !== $m['id']) responder(400, ['error' => 'No se puede cambiar ese rango.']);
        $pdo->beginTransaction();
        if ($rol === 'lider') {
            // Pasar el liderazgo: tú quedas como oficial
            $pdo->prepare("UPDATE clan_miembros SET rol = 'oficial' WHERE cuenta_id = ?")->execute([$yo]);
        }
        $pdo->prepare('UPDATE clan_miembros SET rol = ? WHERE cuenta_id = ?')->execute([$rol, $otro]);
        $pdo->commit();
        responder(200, ['ok' => true]);
    }

    case 'clan_editar': {
        $m = mi_clan($pdo, $yo, ['lider', 'oficial'], 'Solo el líder y los oficiales editan el clan.');
        $pdo->prepare('UPDATE clanes SET descripcion = ?, insignia = ?, abierto = ? WHERE id = ?')
            ->execute([texto($cuerpo['descripcion'] ?? '', 160), insignia_de($cuerpo['insignia'] ?? null), !empty($cuerpo['abierto']) ? 1 : 0, $m['id']]);
        responder(200, ['ok' => true]);
    }

    default:
        responder(400, ['error' => 'Acción desconocida.']);
}
