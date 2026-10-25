{
  description = "mapeo — dev shell with Node, pnpm and a throwaway Postgres in .pgdata/";

  # Same channel as the VM (homelab-docs/nix-flakes/mapeo), so dev runs the same Node and Postgres.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      pg = pkgs.postgresql_16;

      # Socket only, inside .pgdata: no TCP port, so nothing clashes with another Postgres.
      pgStart = ''pg_ctl -D "$PGDATA" -o "-k $PGDATA -c listen_addresses=" -l "$PGDATA/log" -w start'';

      db-up = pkgs.writeShellScriptBin "db-up" ''
        set -e
        if [ ! -f "$PGDATA/PG_VERSION" ]; then
          initdb -D "$PGDATA" -U mapeo --auth=trust >/dev/null
          ${pgStart} >/dev/null
          createdb mapeo
          echo "Postgres created in $PGDATA"
        elif ! pg_ctl -D "$PGDATA" status >/dev/null; then
          ${pgStart} >/dev/null
          echo "Postgres started"
        else
          echo "Postgres already running"
        fi
        pnpm -s db:migrate
      '';

      db-down = pkgs.writeShellScriptBin "db-down" ''
        pg_ctl -D "$PGDATA" status >/dev/null && pg_ctl -D "$PGDATA" -w stop || echo "Postgres not running"
      '';

      db-reset = pkgs.writeShellScriptBin "db-reset" ''
        set -e
        db-down
        rm -rf "$PGDATA"
        db-up
      '';

      db-seed = pkgs.writeShellScriptBin "db-seed" ''
        set -e
        pnpm -s import:osm --relation 356984 --exclude "Paseo de la Castellana"
        if [ "$1" = "--random" ]; then
          psql -qc "update segments set status = case when random() < 0.25 then 'green' when random() < 0.13 then 'yellow' else 'red' end::segment_status;"
          echo "random statuses applied"
        fi
      '';
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = [
          pkgs.nodejs_22
          pkgs.pnpm_12
          pg
          db-up
          db-down
          db-reset
          db-seed
        ];

        shellHook = ''
          export PGDATA="$PWD/.pgdata"
          export PGHOST="$PGDATA"
          export PGUSER=mapeo
          export PGDATABASE=mapeo
          export DATABASE_URL="postgresql:///mapeo?host=$PGDATA&user=mapeo"
          echo "mapeo: db-up · db-seed [--random] · pnpm user:create <user> · pnpm dev · db-down · db-reset"
        '';
      };
    };
}
