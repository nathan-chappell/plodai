import { resetClientToolBroker, setClientToolWorkerFactoryForTests } from "../client-tool-broker";
import { executeToolRequest } from "../client-tool-runtime";

import type {
  ToolExecutionRequestV1,
  ToolExecutionResultV1,
} from "../../types/tool-runtime";

class InlineClientToolWorker {
  onmessage: ((event: MessageEvent<ToolExecutionResultV1>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;

  postMessage(message: ToolExecutionRequestV1): void {
    void executeToolRequest(message)
      .then((result) => {
        this.onmessage?.({ data: result } as MessageEvent<ToolExecutionResultV1>);
      })
      .catch((error) => {
        this.onerror?.({
          message: error instanceof Error ? error.message : "Client tool worker failed.",
        } as ErrorEvent);
      });
  }

  terminate(): void {}

  addEventListener(): void {}

  removeEventListener(): void {}

  dispatchEvent(): boolean {
    return true;
  }
}

export function prepareLiveTestClientToolBroker(): () => void {
  resetClientToolBroker();

  if (typeof Worker !== "undefined") {
    return () => {
      resetClientToolBroker();
    };
  }

  setClientToolWorkerFactoryForTests(
    () => new InlineClientToolWorker() as unknown as Worker,
  );
  return () => {
    setClientToolWorkerFactoryForTests(null);
  };
}
