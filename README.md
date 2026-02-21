# Qwik GRPC ⚡️

This plugin uses [Connect-RPC](https://connectrpc.com/) and [buf.build](https://buf.build/) to generate gRPC clients for use in route loaders and server$ functions.

## Installation

Install buf.build and connect-es:

```bash
pnpm add @bufbuild/buf @bufbuild/protobuf @bufbuild/protoc-gen-es
pnpm add @connectrpc/connect @connectrpc/connect-web
```

Add the qwikGrpc Vite plugin to your vite.config.ts:

```ts
export default defineConfig(({ command, mode }): UserConfig => {
  return {
    plugins: [
      // ...
      qwikGrpc(),
    ],
  };
});
```

Add the generated .qwik-grpc folder to your .gitignore

```
src/.qwik-grpc
```

> If you don't want to generate the qwik-grpc files into your `src/` folder, you can change the `outDir` option in the qwikGrpc() vite.config.ts plugin to an external folder such as node_module/.vite/qwik-grpc. You will need to edit your tsconfig.json file to include the folder in your TypeScript project.

Register your gRPC clients in a plugin file `src/plugin@grpc.ts`:

```ts
import type { RequestEvent, RequestHandler } from "@builder.io/qwik-city";
import { Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { registerGrpcClients } from "~/.grpc/clients";

// OPTIONAL: Add an auth interceptor to capture tokens from the Qwik RequestEvent
// which can be passed to the gRPC server
function authInterceptor(ev: RequestEvent): Interceptor {
  return (next) => async (req) => {
    const token = ev.headers.get("authorization");
    if (token) {
      req.header.set("authorization", token);
    }
    return next(req);
  };
}

// OPTIONAL: Add a trace interceptor to use an existing traceparent ID
function traceInterceptor(ev: RequestEvent): Interceptor {
  return (next) => async (req) => {
    const traceparent = ev.request.headers.get("traceparent");
    if (traceparent) {
      req.header.set("traceparent", traceparent);
    }
    return next(req);
  };
}

// Create a Qwik middleware handler to register the clients
export const onRequest: RequestHandler = async (ev) => {
  // Customise the Connect transport
  const transport = createConnectTransport({
    baseUrl: "http://localhost:8080",
    interceptors: [authInterceptor(ev), traceInterceptor(ev)],
  });

  // Create Connect clients scoped to this event context
  registerGrpcClients(transport, ev);
};
```

You can now access the generated clients in a routeLoader$ or server$ function:

```ts
export const useLoader = routeLoader$(async (ev) => {
  const result = await ev.grpc.bar.say({ sentence: "Success!" });
});

export const serverFn = server$(function (ev) {
  const result = await this.grpc.bar.say({ sentence: "Success!" });
});
```

## Configure

A few options can be passed into the qwikGrpc plugin:

```ts
qwikGrpc({
  // Path to folder of .proto files. Defaults to ./proto
  protoPath?: string;

  // Path to generate Connect clients. Default to "src/.qwik-grpc"
  outDir?: string;

  // Pass any flags to the `buf generate` command. eg: "--debug --version --config"
  bufFlags?: string;

  // Cleans the generated files before regenerating. Use this in place of the buf.build flag --clean.
  // Default: true
  clean?: boolean;
})
```

You can add a buf.gen.yaml file to the current directory or the protoPath. By default, the buf.gen.yaml file used is:

```yaml
version: v2
plugins:
  - local: protoc-gen-es
    include_imports: true
    opt: target=ts
    out: ${outDir}
```
