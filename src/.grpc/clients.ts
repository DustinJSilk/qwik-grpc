
import { RequestEventBase } from "@builder.io/qwik-city";
import { createClient, Transport, Client } from "@connectrpc/connect";
import { BarService } from './bar/v1/bar_pb';
import { FooService } from './foo/v1/foo_pb';
import { TestWordsService } from './test/v1/test_pb';

interface GrpcClients {
  bar: Client<typeof BarService>
  foo: Client<typeof FooService>
  testWords: Client<typeof TestWordsService>
}

class ClientFactory {
  private clients: GrpcClients = {} as GrpcClients;
  private transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  get bar() {
    if (!this.clients.bar) {
      this.clients.bar = createClient(BarService, this.transport);
    }
    return this.clients.bar;
  }

get foo() {
    if (!this.clients.foo) {
      this.clients.foo = createClient(FooService, this.transport);
    }
    return this.clients.foo;
  }

get testWords() {
    if (!this.clients.testWords) {
      this.clients.testWords = createClient(TestWordsService, this.transport);
    }
    return this.clients.testWords;
  }
}

export function registerGrpcClients(transport: Transport, ev: RequestEventBase) {
  (ev as any).grpc = new ClientFactory(transport);
}

declare module "@builder.io/qwik-city" {
  interface RequestEventBase {
    grpc: GrpcClients;
  }
}