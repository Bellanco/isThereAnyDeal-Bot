import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Offline check only: neither authenticates nor verifies cloud capacity/secrets. */
export function checkProduction(config, activate = false) {
  const reject = category => { throw new Error(`production_config_rejected:${category}`); };
  if (!config || typeof config !== 'object') reject('shape');
  const allowedKeys = [
    '$schema', 'name', 'account_id', 'main', 'compatibility_date',
    'workers_dev', 'preview_urls', 'send_metrics', 'triggers', 'vars', 'd1_databases',
  ];
  if (Object.keys(config).some(key => !allowedKeys.includes(key))) reject('surface');
  const vars = config.vars ?? {};
  const allowedVars = [
    'APP_MODE', 'LIVE_DELIVERY', 'OAUTH_CLIENT_ID', 'OAUTH_REDIRECT_URI', 'OAUTH_TOKEN_KEY_VERSION',
  ];
  if (Object.keys(vars).some(key => !allowedVars.includes(key)) ||
      allowedVars.some(key => typeof vars[key] !== 'string')) reject('vars');
  if (/REPLACE|replace-me/.test(JSON.stringify(config)) ||
      config.account_id === '00000000000000000000000000000000' ||
      config.d1_databases?.[0]?.database_id === '00000000-0000-4000-8000-000000000000') reject('placeholders');
  if (!/^[a-f0-9]{32}$/i.test(config.account_id ?? '') ||
      !/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.name ?? '')) reject('identity');
  if (config.main !== 'src/index.ts' || config.workers_dev !== false ||
      config.preview_urls !== false || config.send_metrics !== false ||
      config.routes?.length || config.route || config.assets || config.services ||
      config.kv_namespaces || config.r2_buckets || config.env) reject('surface');
  if (vars.APP_MODE !== 'production' || !vars.OAUTH_CLIENT_ID ||
      /[\u0000-\u0020\u007f]/.test(vars.OAUTH_CLIENT_ID) ||
      !/^[A-Za-z0-9._-]{1,32}$/.test(vars.OAUTH_TOKEN_KEY_VERSION)) reject('oauth');
  let redirect;
  try { redirect = new URL(vars.OAUTH_REDIRECT_URI); } catch { reject('callback'); }
  if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || !redirect.port ||
      redirect.username || redirect.password || redirect.search || redirect.hash) reject('callback');
  const dbs = config.d1_databases;
  if (!Array.isArray(dbs) || dbs.length !== 1 || dbs[0].binding !== 'DB' ||
      Object.keys(dbs[0]).some(key => !['binding', 'database_name', 'database_id', 'migrations_dir'].includes(key)) ||
      !/^[a-z0-9][a-z0-9-]{0,62}$/.test(dbs[0].database_name ?? '') ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(dbs[0].database_id ?? '') ||
      /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(dbs[0].database_id) ||
      dbs[0].migrations_dir !== 'migrations' || dbs[0].remote === true) reject('database');
  if (vars.LIVE_DELIVERY !== (activate ? 'enabled' : 'disabled') ||
      JSON.stringify(config.triggers?.crons) !== JSON.stringify(activate ? ['* * * * *'] : [])) reject('activation');
  return 'production_config_valid_offline_only';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const activate = args.includes('--activate');
    const rest = args.filter(arg => arg !== '--activate');
    if (rest.length !== 2 || rest[0] !== '--config') throw new Error('production_config_rejected:arguments');
    console.log(checkProduction(JSON.parse(readFileSync(rest[1], 'utf8')), activate));
  } catch (error) {
    // Never echo config, file contents, paths, or parser exception input.
    console.error(error instanceof Error && /^production_config_rejected:[a-z]+$/.test(error.message)
      ? error.message : 'production_config_rejected:read');
    process.exitCode = 1;
  }
}
