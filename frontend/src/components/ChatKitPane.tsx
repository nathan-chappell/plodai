import { useEffect, useMemo, useRef } from "react";
import type { Entity, Widgets } from "@openai/chatkit";
import { ChatKit, type UseChatKitOptions, useChatKit } from "@openai/chatkit-react";

import { authenticatedFetch, getChatKitConfig, setChatKitMetadataGetter } from "../lib/api";
import {
  ChatKitPaneCard,
  ChatKitPaneEmpty,
  ChatKitPaneHarness,
  ChatKitPaneSurface,
} from "./styles";

type ChatKitStarterPrompt = {
  label: string;
  prompt: string;
  icon?: "document" | "analytics" | "chart" | "bolt" | "check-circle";
};

export type ChatKitEntityConfig = {
  enabled: boolean;
  showComposerMenu?: boolean;
  onTagSearch: (query: string) => Promise<Entity[]>;
  onClick?: (entity: Entity) => void;
  onRequestPreview?: (
    entity: Entity,
  ) => Promise<{ preview: Widgets.BasicRoot | null }>;
};

const CHATKIT_DEFAULT_MODEL_ID = import.meta.env.VITE_CHATKIT_DEFAULT_MODEL ?? "lightweight";
const CHATKIT_MODEL_CHOICES = [
  {
    id: "lightweight",
    label: import.meta.env.VITE_CHATKIT_LIGHTWEIGHT_MODEL_LABEL ?? "Lightweight",
    description: "Fastest, cheapest exploration pass",
  },
  {
    id: "balanced",
    label: import.meta.env.VITE_CHATKIT_BALANCED_MODEL_LABEL ?? "Balanced",
    description: "Stronger reasoning for deeper analysis",
  },
  {
    id: "powerful",
    label: import.meta.env.VITE_CHATKIT_POWERFUL_MODEL_LABEL ?? "Powerful",
    description: "Best available model for hard cases",
  },
] as const;

function buildStarterPrompts(): readonly ChatKitStarterPrompt[] {
  return [
    {
      label: "Assess field images",
      prompt:
        "Review the current farm images, summarize what stands out visually, and identify the most important follow-up questions.",
      icon: "document",
    },
    {
      label: "Update the farm record",
      prompt:
        "Inspect the saved farm record and latest field images, then suggest the most important record updates before changing anything.",
      icon: "check-circle",
    },
    {
      label: "Draft customer orders",
      prompt:
        "Look at the saved crops and produce a practical set of farm orders that could be published next.",
      icon: "bolt",
    },
  ] as const;
}

export function buildChatKitRequestMetadata(options: {
  threadOrigin?: "interactive" | "ui_integration_test";
}): Record<string, unknown> {
  return {
    ...(options.threadOrigin ? { origin: options.threadOrigin } : {}),
  };
}

export function ChatKitPane({
  farmId,
  activeChatId,
  onActiveChatChange,
  headerTitle = "PlodAI chat",
  greeting = "Review farm images, inspect the saved record, and decide the next step.",
  entitiesConfig,
  showDictation = true,
  surfaceMinHeight,
  threadOrigin = "interactive",
}: {
  farmId: string | null;
  activeChatId?: string | null;
  onActiveChatChange?: (chatId: string | null) => Promise<void> | void;
  headerTitle?: string;
  greeting?: string;
  entitiesConfig?: ChatKitEntityConfig;
  showDictation?: boolean;
  surfaceMinHeight?: number;
  threadOrigin?: "interactive" | "ui_integration_test";
}) {
  useEffect(() => {
    setChatKitMetadataGetter(() =>
      buildChatKitRequestMetadata({
        threadOrigin,
      }),
    );
    return () => {
      setChatKitMetadataGetter(null);
    };
  }, [threadOrigin]);

  return (
    <ChatKitPaneCard>
      <ChatKitPaneHarness>
        {!farmId ? (
          <ChatKitPaneSurface $light $minHeight={surfaceMinHeight} data-testid="chatkit-surface">
            <ChatKitPaneEmpty>Select or create a farm to start chatting with PlodAI.</ChatKitPaneEmpty>
          </ChatKitPaneSurface>
        ) : (
          <ActiveFarmChatKit
            activeChatId={activeChatId}
            entitiesConfig={entitiesConfig}
            farmId={farmId}
            greeting={greeting}
            headerTitle={headerTitle}
            onActiveChatChange={onActiveChatChange}
            showDictation={showDictation}
            surfaceMinHeight={surfaceMinHeight}
          />
        )}
      </ChatKitPaneHarness>
    </ChatKitPaneCard>
  );
}

function ActiveFarmChatKit({
  farmId,
  activeChatId,
  onActiveChatChange,
  headerTitle,
  greeting,
  entitiesConfig,
  showDictation,
  surfaceMinHeight,
}: {
  farmId: string;
  activeChatId?: string | null;
  onActiveChatChange?: (chatId: string | null) => Promise<void> | void;
  headerTitle: string;
  greeting: string;
  entitiesConfig?: ChatKitEntityConfig;
  showDictation: boolean;
  surfaceMinHeight?: number;
}) {
  const threadIdRef = useRef<string | null>(activeChatId ?? null);
  const onActiveChatChangeRef = useRef(onActiveChatChange);

  useEffect(() => {
    onActiveChatChangeRef.current = onActiveChatChange;
  }, [onActiveChatChange]);

  const starterPrompts = useMemo(() => buildStarterPrompts(), []);
  const options = useMemo<UseChatKitOptions>(() => {
    return {
      api: {
        url: getChatKitConfig(farmId).url,
        domainKey: getChatKitConfig(farmId).domainKey,
        fetch: authenticatedFetch,
        uploadStrategy: {
          type: "two_phase",
        },
      },
      initialThread: activeChatId ?? null,
      theme: {
        colorScheme: "light",
        radius: "round",
        density: "compact",
        typography: {
          baseSize: 14,
        },
      },
      history: {
        enabled: true,
        showDelete: false,
        showRename: false,
      },
      threadItemActions: {
        feedback: false,
      },
      header: {
        enabled: true,
        title: {
          enabled: true,
          text: headerTitle,
        },
      },
      startScreen: {
        greeting,
        prompts: starterPrompts.map((prompt) => ({
          label: prompt.label,
          prompt: prompt.prompt,
          icon: prompt.icon,
        })),
      },
      entities: entitiesConfig?.enabled
        ? {
            showComposerMenu: entitiesConfig.showComposerMenu ?? true,
            onTagSearch: entitiesConfig.onTagSearch,
            onClick: entitiesConfig.onClick,
            onRequestPreview: entitiesConfig.onRequestPreview,
          }
        : undefined,
      composer: {
        placeholder: "Ask PlodAI to inspect images, explain the farm record, or save updates.",
        attachments: {
          enabled: true,
          accept: {
            "image/png": [".png"],
            "image/jpeg": [".jpg", ".jpeg"],
            "image/webp": [".webp"],
          },
          maxCount: 6,
          maxSize: 10 * 1024 * 1024,
        },
        dictation: { enabled: showDictation },
        models: CHATKIT_MODEL_CHOICES.map((choice) => ({
          ...choice,
          default: choice.id === CHATKIT_DEFAULT_MODEL_ID,
        })),
      },
      onThreadChange: ({ threadId: nextThreadId }) => {
        threadIdRef.current = nextThreadId;
        void onActiveChatChangeRef.current?.(nextThreadId ?? null);
      },
    };
  }, [
    activeChatId,
    entitiesConfig,
    farmId,
    greeting,
    headerTitle,
    showDictation,
    starterPrompts,
  ]);

  const chatKit = useChatKit(options);

  useEffect(() => {
    if (!chatKit || activeChatId === undefined) {
      return;
    }
    if (threadIdRef.current === activeChatId) {
      return;
    }
    threadIdRef.current = activeChatId;
    void chatKit.setThreadId(activeChatId ?? null);
  }, [activeChatId, chatKit]);

  return (
    <ChatKitPaneSurface $light $minHeight={surfaceMinHeight} data-testid="chatkit-surface">
      <ChatKit control={chatKit.control} />
    </ChatKitPaneSurface>
  );
}
