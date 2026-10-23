import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * render.yaml (Render Blueprint) and .do/app.yaml (DigitalOcean App Platform), checked offline. The Blueprint was
 * also validated against https://render.com/schema/render.yaml.json (docs/plans/ops-notes.md); these tests keep
 * the invariants that schema cannot see: roles, shared secrets, TLS and documented keys.
 */
// js-yaml ships with ESLint's config loader; the tests only need its parser.
const yaml = createRequire(import.meta.url)("js-yaml") as { load(text: string): unknown };
const root = join(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

type EnvVar = {
  key?: string;
  value?: string | number;
  generateValue?: boolean;
  sync?: boolean;
  fromGroup?: string;
  fromDatabase?: { name: string; property: string };
  fromService?: { type: string; name: string; envVarKey?: string; property?: string };
};
type Service = {
  type: string;
  name: string;
  runtime?: string;
  plan?: string;
  region?: string;
  dockerfilePath?: string;
  dockerContext?: string;
  dockerCommand?: string;
  preDeployCommand?: string;
  healthCheckPath?: string;
  envVars?: EnvVar[];
};
type Blueprint = {
  databases: { name: string; region?: string; plan?: string; postgresMajorVersion?: string; ipAllowList?: unknown[] }[];
  envVarGroups: { name: string; envVars: EnvVar[] }[];
  services: Service[];
};

const blueprint = yaml.load(read("render.yaml")) as Blueprint;
const [database] = blueprint.databases;
const groups = new Map(blueprint.envVarGroups.map((group) => [group.name, group.envVars]));
const web = blueprint.services.filter((service) => service.type === "web");
const workers = blueprint.services.filter((service) => service.type === "worker");
const byName = (name: string) => blueprint.services.find((service) => service.name === name)!;

/** Every variable a service ends up with, its groups included. */
function keysOf(service: Service) {
  return (service.envVars ?? []).flatMap((env) => (env.fromGroup ? (groups.get(env.fromGroup) ?? []).map((item) => item.key!) : [env.key!]));
}

/** The variables lib/env.ts refuses to start without in production, plus the always-required ones. */
function productionKeys() {
  const source = read("lib/env.ts");
  const list = /const missing = \[([^\]]+)\]/.exec(source)?.[1] ?? "";
  const required = [...list.matchAll(/"([A-Z0-9_]+)"/g)].map((match) => match[1]);
  expect(required).toContain("PAYMENT_SECRETS_KEY");
  return [...required, "DATABASE_URL", "AUTH_SECRET", "SUPER_ADMIN_EMAIL", "EMAIL_FROM", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "NODE_ENV"];
}

describe("render.yaml", () => {
  it("runs the web service, the BullMQ worker and beat from the same Dockerfile", () => {
    expect(web).toHaveLength(1);
    expect(web[0]).toMatchObject({ name: "swbook-backend", runtime: "docker", healthCheckPath: "/api/health" });
    expect(web[0].preDeployCommand).toBe("docker-entrypoint.sh --role migrate");
    expect(web[0].dockerCommand).toBeUndefined();
    expect(workers.map((worker) => [worker.name, worker.dockerCommand])).toEqual([
      ["swbook-worker", "docker-entrypoint.sh --role worker node dist/worker.js"],
      ["swbook-beat", "docker-entrypoint.sh --role beat node dist/beat.js"],
    ]);
    for (const service of blueprint.services) {
      expect(service).toMatchObject({ runtime: "docker", dockerfilePath: "./Dockerfile", dockerContext: ".", region: database.region });
      expect(["starter", "standard", "pro", "0.5c-512mb", "1c-2g", "2c-4g"]).toContain(service.plan);
    }
    expect(blueprint.services.some((service) => /scheduler/i.test(`${service.name} ${service.dockerCommand ?? ""}`))).toBe(false);
  });

  it("creates a private managed PostgreSQL 16 and reaches it over TLS", () => {
    expect(database).toMatchObject({ name: "swbook-db", postgresMajorVersion: "16", ipAllowList: [] });
    const shared = groups.get("swbook-shared")!;
    expect(shared.find((env) => env.key === "DATABASE_URL_SSLMODE")?.value).toBe("require");
    for (const service of blueprint.services) {
      expect(service.envVars).toContainEqual({ key: "DATABASE_URL", fromDatabase: { name: "swbook-db", property: "connectionString" } });
    }
    expect(read("scripts/docker-entrypoint.sh")).toContain("DATABASE_URL_SSLMODE");
  });

  it("generates every secret once, in the shared group, and never prompts inside a group", () => {
    const shared = groups.get("swbook-shared")!;
    for (const key of ["AUTH_SECRET", "CRON_SECRET", "HEALTHCHECK_SECRET", "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY", "MFA_ENCRYPTION_KEY", "PAYMENT_SECRETS_KEY"]) {
      expect(shared.find((env) => env.key === key), key).toEqual({ key, generateValue: true });
    }
    // Render ignores sync: false and service references inside an environment group.
    for (const env of shared) expect(env.sync === undefined && !env.fromService && !env.fromDatabase, env.key).toBe(true);
    for (const service of blueprint.services) expect(service.envVars).toContainEqual({ fromGroup: "swbook-shared" });
  });

  it("gives the web service, worker and beat everything production requires", () => {
    for (const service of blueprint.services) {
      const keys = keysOf(service);
      for (const key of productionKeys()) expect(keys, `${service.name} lacks ${key}`).toContain(key);
      expect(new Set(keys).size, `${service.name} sets a variable twice`).toBe(keys.length);
    }
  });

  it("asks for each operator value once, on the web service, and shares it with the worker and beat", () => {
    const asked = (web[0].envVars ?? []).filter((env) => env.sync === false).map((env) => env.key!);
    expect(asked).toEqual(expect.arrayContaining(["REDIS_URL", "SUPER_ADMIN_EMAIL", "SMTP_PASSWORD", "S3_BUCKET", "S3_SECRET_ACCESS_KEY"]));
    for (const worker of workers) {
      expect((worker.envVars ?? []).some((env) => env.sync === false)).toBe(false);
      for (const key of [...asked, "NEXT_PUBLIC_BASE_URL", "AUTH_URL"]) {
        expect(worker.envVars).toContainEqual({ key, fromService: { type: "web", name: "swbook-backend", envVarKey: key } });
      }
    }
    for (const key of ["NEXT_PUBLIC_BASE_URL", "AUTH_URL"]) {
      expect(web[0].envVars).toContainEqual({ key, fromService: { type: "web", name: "swbook-backend", envVarKey: "RENDER_EXTERNAL_URL" } });
    }
    for (const env of blueprint.services.flatMap((service) => service.envVars ?? [])) {
      if (env.fromService) expect(byName(env.fromService.name), env.key).toBeDefined();
    }
  });

  it("documents every key in .env.production.example and docs/CONFIGURATION.md", () => {
    const template = read(".env.production.example");
    const configuration = read("docs/CONFIGURATION.md");
    const keys = new Set(blueprint.services.flatMap(keysOf));
    for (const key of keys) {
      expect(template, `${key} in .env.production.example`).toMatch(new RegExp(`^(# )?${key}=`, "m"));
      expect(configuration, `${key} in docs/CONFIGURATION.md`).toContain(`\`${key}\``);
    }
  });

  it("links the Deploy to Render button", () => {
    const button = "https://render.com/deploy?repo=https://github.com/SpaceWorks-HQ/SpaceWorks-Bookings";
    expect(read("render.yaml")).toContain(button);
    expect(read("docs/DEPLOYMENT_CLOUD.md")).toContain(button);
  });
});

describe(".do/app.yaml", () => {
  type Component = { name: string; kind?: string; run_command?: string; image: { repository: string; tag: string } };
  const spec = yaml.load(read(".do/app.yaml")) as { services: Component[]; jobs: Component[]; workers: Component[]; envs: { key: string }[] };

  it("runs every role from the backend image with an explicit --role", () => {
    const components = [...spec.services, ...spec.jobs, ...spec.workers];
    expect(components.map((component) => [component.name, component.run_command])).toEqual([
      ["web", "docker-entrypoint.sh --role backend node server.js"],
      ["migrate", "docker-entrypoint.sh --role migrate"],
      ["worker", "docker-entrypoint.sh --role worker node dist/worker.js"],
      ["beat", "docker-entrypoint.sh --role beat node dist/beat.js"],
    ]);
    expect(spec.jobs[0].kind).toBe("PRE_DEPLOY");
    for (const component of components) expect(component.image.repository).toBe("spaceworks-bookings-backend");
  });

  it("sets everything production requires", () => {
    const keys = spec.envs.map((env) => env.key);
    for (const key of productionKeys()) expect(keys, key).toContain(key);
  });
});
