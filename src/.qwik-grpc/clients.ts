import { RequestEventBase } from "@builder.io/qwik-city";
import { createClient, Transport, Client } from "@connectrpc/connect";
import { BarService } from "./bar/v1/bar_pb";
import { FooService } from "./foo/v1/foo_pb";
import { TestWordsService } from "./test/v1/test_pb";

export function registerGrpcClients(
  transport: Transport,
  ev: RequestEventBase
) {
  ev.sharedMap.set("qwik-grpc-clients", {
    bar: createClient(BarService, transport),
    foo: createClient(FooService, transport),
    testWords: createClient(TestWordsService, transport),
  });
}

interface GrpcClients {
  bar: Client<typeof BarService>;
  foo: Client<typeof FooService>;
  testWords: Client<typeof TestWordsService>;
}

export function grpc(ev: RequestEventBase): GrpcClients {
  return ev.sharedMap.get("qwik-grpc-clients");
}
