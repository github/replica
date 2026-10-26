import { randomUUID } from "node:crypto"
import type { OutgoingHttpHeader, OutgoingHttpHeaders } from "node:http"
import type { Request, RequestHandler, Response } from "express"
import type { Logger } from "pino"
import { pinoHttp } from "pino-http"

import { sanitizeLogValue } from "../../../utils/logging/sanitize-log-value/index.ts"
import { logger } from "../index.ts"
import type { RequestSnapshot } from "./types.ts"

export function createRequestLogger(target: Logger = logger): RequestHandler {
  const snapshots = new WeakMap<Response, RequestSnapshot>()

  function snapshot(request: Request): RequestSnapshot {
    const route: unknown = request.route
    const path =
      route !== null && typeof route === "object" && "path" in route ? route.path : undefined
    return {
      route: typeof path === "string" ? path : null,
      params: sanitizeLogValue(request.params),
      query: sanitizeLogValue(request.query),
      ...(request.is("application/json") && request.body !== undefined
        ? { body: sanitizeLogValue(request.body) }
        : {}),
    }
  }

  function record(request: Request, response: Response, responseTime: number) {
    const captured = snapshots.get(response) ?? snapshot(request)
    const completed = response.writableFinished && !request.readableAborted
    const { route, ...payload } = captured
    return {
      method: request.method,
      route,
      statusCode: completed ? response.statusCode : null,
      responseTime,
      outcome: completed ? "completed" : "aborted",
      ...(response.locals.omitLogPayload === true ? {} : payload),
    }
  }

  const middleware = pinoHttp<Request, Response>({
    logger: target,
    quietReqLogger: true,
    quietResLogger: true,
    wrapSerializers: false,
    serializers: {
      req: () => undefined,
      res: () => undefined,
      err: () => undefined,
    },
    genReqId(_request, response) {
      const id = randomUUID()
      response.setHeader("X-Request-Id", id)
      return id
    },
    customLogLevel(request, response, error) {
      if (
        error ||
        !response.writableFinished ||
        request.readableAborted ||
        response.statusCode >= 500
      ) {
        return "error"
      }
      return response.statusCode >= 400 ? "warn" : "info"
    },
    customSuccessObject(request, response, value: { responseTime: number }) {
      return record(request, response, value.responseTime)
    },
    customErrorObject(request, response, _error, value: { responseTime: number }) {
      return record(request, response, value.responseTime)
    },
    customSuccessMessage(request, response) {
      return response.writableFinished && !request.readableAborted
        ? "Request completed"
        : "Request aborted"
    },
    customErrorMessage: () => "Request failed",
  })

  return (request, response, next) => {
    // Capture before Express restores mounted router parameters after sending a response.
    const writeHead = response.writeHead.bind(response)
    response.writeHead = function (
      statusCode: number,
      statusMessageOrHeaders?: string | OutgoingHttpHeaders | OutgoingHttpHeader[],
      headers?: OutgoingHttpHeaders | OutgoingHttpHeader[],
    ) {
      snapshots.set(response, snapshot(request))
      return typeof statusMessageOrHeaders === "string"
        ? writeHead(statusCode, statusMessageOrHeaders, headers)
        : writeHead(statusCode, statusMessageOrHeaders)
    }
    middleware(request, response, next)
  }
}
