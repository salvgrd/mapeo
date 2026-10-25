# mapeo

Mapa de calles del distrito de Tetuán para el comité de huelga. Cada tramo de calle (de cruce a cruce) está **sin empapelar** (rojo), con **carteles deteriorados** (amarillo) o **empapelado** (verde). Se puede ver el distrito entero o un barrio. Cualquiera puede ver el mapa; para cambiar un estado hace falta una cuenta.

Next.js (App Router) · Drizzle · PostgreSQL · Leaflet + OpenStreetMap. Producción: `https://mapeo.shawa.io`, VM 117 en la DMZ del homelab. La infraestructura está en `homelab-docs` (`docs/services/mapeo.md`).

> **Vibecodeado.** Este código lo ha escrito casi entero una IA (Claude), guiada y revisada por una persona. Funciona y se ha probado, pero no ha tenido la revisión que tendría código escrito a mano. Revísalo antes de confiarle algo importante.

Sirve para cualquier distrito con límites de barrio en OpenStreetMap, no solo para Tetuán. Ver [Otro distrito](#otro-distrito).

## Desarrollo

`nix develop` abre un shell con Node 22, pnpm 12 y Postgres 16, las mismas versiones que la VM. Postgres guarda sus datos en `.pgdata/` (ignorado por git) y solo escucha en un socket dentro de esa carpeta, sin puerto TCP. El shell exporta `DATABASE_URL`, así que `psql` sin argumentos ya entra en la base de datos.

La primera vez:

```bash
nix develop
pnpm install
db-up                      # crea la base de datos si no existe, la arranca y migra
db-seed --random           # importa OSM_RELATION (Tetuán por defecto); --random pinta estados al azar
pnpm user:create <usuario> # pide la contraseña
pnpm dev                   # http://localhost:3000
```

Las siguientes veces: `nix develop`, `db-up` y `pnpm dev`. Para pararlo, `db-down`. `db-reset` borra la base de datos y la crea vacía.

Sin Nix, cualquier Postgres vale: exporta las variables de `.env.example` y usa `pnpm db:migrate` y `pnpm import:osm`.

## Otro distrito

`import:osm` lee dos variables, y cada una se puede sustituir con su flag:

| Variable | Flag | Tetuán |
|---|---|---|
| `OSM_RELATION` | `--relation <id>` | `356984` |
| `OSM_EXCLUDE` | `--exclude "<calle>"` (repetible) | `Paseo de la Castellana` |

`OSM_RELATION` es el id de la relación del distrito en OSM. Busca el distrito en openstreetmap.org y copia el número de la URL (`/relation/356984`). Sus barrios deben ser límites con `admin_level=10` dentro de él; si tu ciudad usa otro nivel, pasa `--sub-level`. `OSM_EXCLUDE` son calles que no se pueden empapelar, separadas por `;`. Un flag sustituye a su variable, no se suma a ella.

El dev shell pone Tetuán por defecto. Para otro distrito, exporta las variables antes de `nix develop`. El mapa se centra solo en los barrios importados.

## Importar

`import:osm` descarga los barrios del distrito (límites OSM con `admin_level=10`) y sus calles con nombre. Corta cada calle en tramos en cada cruce y asigna cada tramo al barrio donde cae su punto medio. Descarta los túneles y las calles pasadas con `--exclude` (se puede repetir).

- `--dry-run` muestra el recuento por barrio sin escribir nada.
- Si se vuelve a ejecutar, conserva el estado de cada tramo mientras OSM no cambie esa vía. Los tramos que ya no existen se avisan; `--prune` los borra junto con su historial.
- Hay que pasar los mismos `--exclude` cada vez, o las calles excluidas vuelven.

Cambiar el esquema: editar `src/db/schema.ts`, luego `pnpm db:generate` y commitear la migración nueva de `drizzle/`.

## Despliegue

Un push a `main` lanza `.gitea/workflows/deploy.yml`: build, rsync a `/opt/mapeo` y reinicio del servicio. Las migraciones se aplican al arrancar el servicio.

`pnpm build` también empaqueta los scripts en `dist/scripts/*.mjs`, que se despliegan en `/opt/mapeo/scripts/`. En la VM, como root:

```bash
cd /opt/mapeo
sudo -u mapeo DATABASE_URL='postgresql:///mapeo?host=/run/postgresql' node scripts/create-user.mjs <usuario>
sudo -u mapeo DATABASE_URL='postgresql:///mapeo?host=/run/postgresql' node scripts/delete-user.mjs <usuario>
sudo -u mapeo DATABASE_URL='postgresql:///mapeo?host=/run/postgresql' node scripts/import-osm.mjs --relation 356984 --exclude "Paseo de la Castellana"
```

## Seguridad

- No hay registro. Las cuentas se crean con `create-user`. Las contraseñas se guardan con argon2id y deben tener 10 caracteres como mínimo.
- La base de datos guarda la sesión como sha256 del token. La cookie es `HttpOnly`, `Secure` y `SameSite=Lax`, y caduca a los 30 días.
- Cada Server Action que escribe comprueba la sesión en el servidor.
- Tras 5 intentos fallidos en 15 minutos, el login se bloquea para ese usuario. El contador vive en memoria, así que un reinicio lo borra.
- Con `TRUST_PROXY=1` también se bloquea por IP, usando la última entrada de `X-Forwarded-For`. Actívalo solo si a la app se llega únicamente a través de un proxy que reescribe esa cabecera (Caddy lo hace por defecto). Sin proxy, la cabecera la pone el cliente y cualquiera puede cambiar de "IP" en cada intento.
- Cada cambio de estado queda en `status_changes` con quién lo hizo y cuándo.

## Licencia

MIT, ver `LICENSE`. Los datos de calles y barrios vienen de OpenStreetMap (© colaboradores de OpenStreetMap, ODbL) y no están en este repo: se descargan al importar.
