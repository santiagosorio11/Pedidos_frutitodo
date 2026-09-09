type ServerEnv = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  ghlIngestSecret: string;
  embedTokenPepper: string;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getServerEnv(): ServerEnv {
  return {
    supabaseUrl: required("SUPABASE_URL"),
    supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    ghlIngestSecret: required("GHL_INGEST_SECRET"),
    embedTokenPepper: required("EMBED_TOKEN_PEPPER"),
  };
}
