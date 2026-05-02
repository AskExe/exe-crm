#!/bin/sh
set -e

assert_exe_license_key() {
    license_key="${EXE_LICENSE_KEY:-${ENTERPRISE_KEY:-}}"

    if [ -z "$license_key" ]; then
        echo "EXE_LICENSE_KEY is required. Obtain a valid key from https://askexe.com before booting Exe CRM."
        exit 1
    fi

    case "$license_key" in
        CHANGEME*|changeme*|replace_me*|REPLACE_ME*|your_*|YOUR_*|example*|EXAMPLE*)
            echo "EXE_LICENSE_KEY is still a placeholder value. Replace it with a real key from https://askexe.com."
            exit 1
            ;;
    esac

    export EXE_LICENSE_KEY="$license_key"
    export ENTERPRISE_KEY="${ENTERPRISE_KEY:-$license_key}"
}

setup_and_migrate_db() {
    if [ "${DISABLE_DB_MIGRATIONS}" = "true" ]; then
        echo "Database setup and migrations are disabled, skipping..."
        return
    fi

    echo "Running database setup and migrations..."

    # Run setup and migration scripts
    has_schema=$(psql -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'core')" ${PG_DATABASE_URL})
    if [ "$has_schema" = "f" ]; then
        echo "Database appears to be empty, running migrations."
        yarn database:init:prod
    fi

    yarn command:prod cache:flush
    yarn command:prod upgrade
    yarn command:prod cache:flush

    echo "Successfully migrated DB!"
}

register_background_jobs() {
    if [ "${DISABLE_CRON_JOBS_REGISTRATION}" = "true" ]; then
        echo "Cron job registration is disabled, skipping..."
        return
    fi

    echo "Registering background sync jobs..."
    if yarn command:prod cron:register:all; then
        echo "Successfully registered all background sync jobs!"
    else
        echo "Warning: Failed to register background jobs, but continuing startup..."
    fi
}

assert_exe_license_key
setup_and_migrate_db
register_background_jobs

# Continue with the original Docker command
exec "$@"
