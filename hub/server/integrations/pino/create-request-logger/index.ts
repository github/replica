import { randomUUID } from "node:crypto"
import type { OutgoingHttpHeader, OutgoingHttpHeaders } from "node:http"
import type { Request, RequestHandler, Response } from "express"
import type { Logger } from "pino"
import { pinoHttp } from "pino-http"

import { createRequestRecord } from "../create-request-record/index.ts"
import { logger } from "../index.ts"
import { snapshotRequest } from "../snapshot-request/index.ts"
import type { RequestSnapshot } from "../snapshot-request/types.ts"

/** Log each request once, including parser failures and interrupted responses. */
export function createRequestLogger(target: Logger = logger): RequestHandler {
  const snapshots = new WeakMap<Response, RequestSnapshot>()

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
      return createRequestRecord(request, response, value.responseTime, snapshots.get(response))
    },
    customErrorObject(request, response, _error, value: { responseTime: number }) {
      return createRequestRecord(request, response, value.responseTime, snapshots.get(response))
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
      snapshots.set(response, snapshotRequest(request))
      return typeof statusMessageOrHeaders === "string"
        ? writeHead(statusCode, statusMessageOrHeaders, headers)
        : writeHead(statusCode, statusMessageOrHeaders)
    }
    middleware(request, response, next)
  }
}
