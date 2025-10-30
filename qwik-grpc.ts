import { Plugin } from "vite";
import { exec } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

interface QwikGrpcOptions {
  // Path to folder of .proto files. Defaults to ./proto
  protoPath?: string;

  // Path to generate Connect clients. Default to "src/.qwik-grpc"
  outDir?: string;

  // Pass any flags to the `buf generate` command. eg: "--debug --version"
  bufFlags?: string;

  // Cleans the generated files before regenerating. Use this in place of the buf.build flag --clean.
  // Default: true
  clean?: boolean;
}

interface Service {
  // Foo
  name: string;

  // foo
  instanceName: string;

  // FooService
  serviceName: string;

  // outDir/foo/v1/foo_pb.ts
  path: string;
}

// Returns a default buf.gen.yaml file
function defaultBufGenYaml(outDir: string): string {
  return `
version: v2
plugins:
  - local: protoc-gen-es
    include_imports: true
    opt: target=ts
    out: ${outDir}
`;
}

// Locate a buf.gen template, preferring project root, then proto folder.
async function findBufGenTemplate(
  protoPath: string,
  outDir: string
): Promise<string> {
  const candidates = ["buf.gen.yaml", "buf.gen.yml", "buf.gen.json"].flatMap(
    (name) => [path.join(process.cwd(), name), path.join(protoPath, name)]
  );

  for (const file of candidates) {
    try {
      const found = await fs.readFile(file, "utf8");
      console.log(`[qwikGrpc] Using ${path.relative(process.cwd(), file)}`);
      return found;
    } catch {
      // Ignore files that aren't found
    }
  }

  return defaultBufGenYaml(outDir);
}

// Run buf generate and return all generated *_pb.ts files.
async function runBufGenerate(
  protoPath: string,
  outDir: string,
  flags: string
): Promise<string[]> {
  await fs.mkdir(outDir, { recursive: true });

  const bufGenContent = await findBufGenTemplate(protoPath, outDir);

  // Save the template temporarily (buf CLI doesn’t support inline YAML well)
  const tmpPath = path.join(outDir, "buf.gen.tmp.yaml");

  await fs.writeFile(tmpPath, bufGenContent, { encoding: "utf8" });
  try {
    await execAsync(
      `npx buf generate ${protoPath} --template ${tmpPath} ${flags}`
    );
  } catch (err) {
    console.error("[qwikGrpc] buf generate failed:", err);
    throw err;
  } finally {
    await fs.unlink(tmpPath);
  }

  const files: string[] = [];

  const walk = async (dir: string) => {
    const entries = await fs.readdir(dir);

    for (const entry of entries) {
      const full = path.join(dir, entry);
      const stat = await fs.stat(full);

      if (stat.isDirectory()) {
        await walk(full);
      } else if (entry.endsWith("_pb.ts")) {
        files.push(full);
      }
    }
  };
  await walk(outDir);

  return files;
}

// Creates a list of Services by reading the generated clients
async function getServices(
  outDir: string,
  files: string[]
): Promise<Service[]> {
  const services: Service[] = [];

  for (const filePath of files) {
    const fileContent = await fs.readFile(filePath, "utf8");

    // Match pattern: export const FooService: GenService<...
    const match = fileContent.match(
      /export\s+const\s+(\w+)Service\s*:\s*GenService\s*</
    );

    if (!match) {
      console.warn(`[qwikGrpc] No service export found in ${filePath}`);
      continue;
    }

    const name = match[1]; // e.g. "Foo"
    const instanceName = name[0].toLowerCase() + name.slice(1); // e.g. "foo"
    const serviceName = `${name}Service`; // e.g. "FooService"
    const relPath =
      "./" +
      path.relative(outDir, filePath).replace(/\\/g, "/").replace(/\.ts$/, "");

    services.push({ serviceName, name, instanceName, path: relPath });
  }

  return services;
}

// Generates the client.ts file which registers the clients
async function generateClientsFile(outDir: string, services: Service[]) {
  const imports = [
    `import { RequestEventBase } from "@builder.io/qwik-city";`,
    `import { createClient, Transport, Client } from "@connectrpc/connect";`,
    ...services.map((s, i) => {
      return `import { ${s.serviceName} } from '${s.path}';`;
    }),
  ].join("\n");

  const interfaces = `
    interface GrpcClients {
      ${services.map((s, i) => `${s.instanceName}: Client<typeof ${s.serviceName}>`).join("\n")}
    }
  `;

  const factory = `
    class ClientFactory {
      private clients: GrpcClients = {} as GrpcClients;
      private transport: Transport;

      constructor(transport: Transport) {
        this.transport = transport;
      }

      ${services
        .map(
          (s, i) => `get ${s.instanceName}() {
        if (!this.clients.${s.instanceName}) {
          this.clients.${s.instanceName} = createClient(${s.serviceName}, this.transport);
        }
        return this.clients.${s.instanceName};
      }`
        )
        .join("\n\n")}
    }
  `;

  const register = `
    export function registerGrpcClients(transport: Transport, ev: RequestEventBase) {
      ev.sharedMap.set("qwik-grpc-clients", new ClientFactory(transport));
    }
  `;

  const getter = `
    export function grpc(ev: RequestEventBase): GrpcClients {
      return ev.sharedMap.get('qwik-grpc-clients')
    }
  `;

  const data = `
    ${imports}
    ${interfaces}
    ${factory}
    ${register}
    ${getter}
  `;

  await fs.writeFile(path.join(outDir, "clients.ts"), data, "utf8");

  try {
    await execAsync(`npx prettier --write ${outDir}/clients.ts`);
  } catch {}
}

export function qwikGrpc(options?: QwikGrpcOptions): Plugin {
  const {
    protoPath = "proto",
    outDir = "src/.qwik-grpc",
    bufFlags = "",
    clean = true,
  } = options || {};

  let isGenerated = false;

  async function generate() {
    if (clean) {
      await fs.rm(outDir, { recursive: true, force: true });
    }

    const generatedFiles = await runBufGenerate(protoPath, outDir, bufFlags);
    const services = await getServices(outDir, generatedFiles);
    await generateClientsFile(outDir, services);
  }

  return {
    name: "vite-plugin-qwik-grpc",
    enforce: "pre",

    async configResolved() {
      if (!isGenerated) {
        isGenerated = true;
        await generate();
      }
    },

    configureServer(server) {
      let regenTimer: NodeJS.Timeout | null = null;

      // Watch the entire proto directory recursively
      server.watcher.add(protoPath);

      // React to any changes inside it
      server.watcher.on("all", (event, file) => {
        // Don't generate if the file isn't a .proto file
        if (!file.endsWith(".proto")) {
          return;
        }

        // Don't generate if the file isn't in the outDir
        if (file.startsWith(outDir) || file.includes(outDir)) {
          return;
        }

        if (["add", "change", "unlink"].includes(event)) {
          // Debounce to avoide unecessary rebuilds
          if (regenTimer) {
            clearTimeout(regenTimer);
          }

          regenTimer = setTimeout(async () => {
            await generate();
            server.ws.send({ type: "full-reload" });
          }, 100);
        }
      });
    },
  };
}
