import type { RequestEvent, RequestHandler } from "@builder.io/qwik-city";
import { Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { registerGrpcClients } from "~/.qwik-grpc/clients";

function authInterceptor(ev: RequestEvent): Interceptor {
  return (next) => async (req) => {
    const someAuthToken = "authenticate(ev)";
    req.header.set("authorization", `Bearer ${someAuthToken}`);
    return next(req);
  };
}

function traceInterceptor(ev: RequestEvent): Interceptor {
  return (next) => async (req) => {
    const traceparent = ev.request.headers.get("traceparent");
    if (traceparent) {
      req.header.set("traceparent", traceparent);
    }
    return next(req);
  };
}

export const onRequest: RequestHandler = async (ev) => {
  const transport = createConnectTransport({
    baseUrl: "http://localhost:8080",
    interceptors: [authInterceptor(ev), traceInterceptor(ev)],
  });

  registerGrpcClients(transport, ev);
};
