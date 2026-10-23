import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Invariants of the Compose stacks that `docker compose config` cannot see: image names, process roles, the
 * worker and beat health checks, matching application settings in both topologies and documented variables.
 * CI and docs/plans/ops-notes.md also run `docker compose config` for every layer and the full compose smoke.
 */
type YamlType = new (tag: string, options: { kind: "mapping" | "sequence" | "scalar"; construct(data: unknown): unknown }) => unknown;
type JsYaml = { load(text: string, options?: { schema: unknown }): unknown; Type: YamlType; DEFAULT_SCHEMA: { extend(types: unknown[]): unknown } };
// js-yaml ships with ESLint's config loader; the tests only need its parser.
const yaml = createRequire(import.meta.url)("js-yaml") as JsYaml;
// Compose's own merge tags (`!override`, `!reset`) keep their value for these checks.
const schema = yaml.DEFAULT_SCHEMA.extend(
  ["!override", "!reset"].flatMap((tag) => (["mapping", "sequence", "scalar"] as const).map((kind) => new yaml.Type(tag, { kind, construct: (data) => data }))),
);
const root = join(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

type Service = {
  image?: string;
  command?: string[];
  profiles?: string[];
  environment?: Record<string, string>;
  healthcheck?: { test: string[] };
  stop_grace_period?: string;
  networks?: string[];
};
type ComposeFile = { services: Record<string, Service> };
const load = (file: string) => yaml.load(read(file), { schema }) as ComposeFile;

const bundled = load("docker-compose.prod.yml");
const cloud = load("docker-compose.cloud.yml");
const overlays = ["docker/compose.build.yml", "docker/compose.external-storage.yml", "docker/compose.proxy.yml", "docker/compose.tls.yml"];
const FILES = ["docker-compose.prod.yml", "docker-compose.cloud.yml", "docker-compose.yml", ...overlays];
const backendImage = "${SWB_BACKEND_IMAGE:-ghcr.io/spaceworks-hq/spaceworks-bookings-backend}:${SWB_IMAGE_TAG:-latest}";

describe("compose stacks", () => {
  it("runs exactly the bundled and cloud services", () => {
    expect(Object.keys(bundled.services).sort()).toEqual(
      ["backend", "backup", "backup-storage", "beat", "caddy", "createbuckets", "db", "migrate", "minio", "ops", "redis", "worker"].sort(),
    );
    expect(Object.keys(cloud.services).sort()).toEqual(["backend", "beat", "migrate", "ops", "worker"]);
    expect(bundled.services.minio.image).toMatch(/^pgsty\/silo:/);
    expect(bundled.services.createbuckets.image).toMatch(/^pgsty\/silo:/);
    expect(bundled.services.ops.profiles).toEqual(["tools"]);
  });

  it("names every Space Works image spaceworks-bookings and runs every backend role from one image", () => {
    for (const stack of [bundled, cloud]) {
      for (const name of ["migrate", "backend", "worker", "beat", "ops"]) expect(stack.services[name].image, name).toBe(backendImage);
    }
    for (const file of FILES) {
      for (const [name, service] of Object.entries(load(file).services)) {
        if (service.image?.includes("spaceworks")) expect(service.image, `${file} ${name}`).toContain("spaceworks-bookings-backend");
      }
    }
  });

  it("starts each backend role with an explicit --role and never a scheduler", () => {
    for (const stack of [bundled, cloud]) {
      expect(stack.services.migrate.command).toEqual(["--role", "migrate"]);
      expect(stack.services.backend.command).toEqual(["--role", "backend", "node", "server.js"]);
      expect(stack.services.worker.command).toEqual(["--role", "worker", "node", "dist/worker.js"]);
      expect(stack.services.beat.command).toEqual(["--role", "beat", "node", "dist/beat.js"]);
      expect(stack.services.ops.command).toEqual(["--role", "ops", "node", "docker/ops/check.mjs"]);
    }
    for (const file of [...FILES, "Dockerfile", "render.yaml", ".do/app.yaml", "scripts/docker-entrypoint.sh", "docker/ops/check.mjs"]) {
      expect(read(file), file).not.toMatch(/scheduler/i);
    }
    expect(read("scripts/docker-entrypoint.sh")).toMatch(/^\s+worker\|beat\|ops\)$/m);
  });

  it("health-checks the worker and beat on their own /health at port 3460", () => {
    for (const stack of [bundled, cloud]) {
      for (const role of ["worker", "beat"]) {
        const service = stack.services[role];
        expect(service.healthcheck?.test.join(" "), role).toContain("http://127.0.0.1:3460/health");
        expect(service.environment?.JOBS_HEALTH_PORT, role).toBe("3460");
        expect(service.environment?.JOBS_INPROCESS, role).toBe("false");
        expect(service.stop_grace_period, role).toBeDefined();
      }
    }
    // The operator checks probe both from the ops container.
    expect(read("docker/ops/check.mjs")).toContain("http://${role}:3460/health");
    expect(read("scripts/compose-smoke.sh")).toContain("127.0.0.1:3460/health");
  });

  it("gives both topologies the same application settings", () => {
    const keys = (service: Service) => Object.keys(service.environment ?? {}).sort();
    const bundledOnly = ["ALLOW_PLAIN_HTTP", "NODE_EXTRA_CA_CERTS"];
    const cloudOnly = ["TRUSTED_PROXY_HOPS"];
    expect(keys(bundled.services.backend).filter((key) => !bundledOnly.includes(key))).toEqual(
      keys(cloud.services.backend).filter((key) => !cloudOnly.includes(key)),
    );
    for (const stack of [bundled, cloud]) {
      for (const role of ["worker", "beat"]) expect(keys(stack.services[role])).toEqual(keys(stack.services.backend));
    }
  });

  it("keeps the data services off the internet and hides the job triggers at the edge", () => {
    expect(read("docker-compose.prod.yml")).toMatch(/^ {2}data:\n {4}internal: true$/m);
    for (const name of ["db", "redis", "minio", "createbuckets", "migrate", "backup", "backup-storage"]) {
      expect(bundled.services[name].networks, name).toEqual(["data"]);
    }
    expect(read("deploy/Caddyfile")).toMatch(/handle \/api\/internal\/\* \{\s+respond 404/);
  });

  it("documents every variable the Compose files read", () => {
    const configuration = read("docs/CONFIGURATION.md");
    const variables = new Set(FILES.flatMap((file) => [...read(file).matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((match) => match[1])));
    expect(variables.size).toBeGreaterThan(40);
    for (const variable of variables) expect(configuration, variable).toContain(variable);
  });
});
