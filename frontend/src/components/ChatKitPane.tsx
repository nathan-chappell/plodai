import { useEffect, useMemo, useRef } from "react";
import type { Entity, Widgets } from "@openai/chatkit";
import { ChatKit, type UseChatKitOptions, useChatKit } from "@openai/chatkit-react";

import { publishToast } from "../app/toasts";
import type { PreferredOutputLanguage } from "../lib/chat-language";
import {
  authenticatedFetch,
  getChatKitConfig,
  setChatKitMetadataGetter,
  setChatKitOutputLanguageGetter,
} from "../lib/api";
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

type ChatKitClientEffect = {
  name: string;
  data?: Record<string, unknown>;
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

const CHATKIT_DEFAULT_MODEL_ID = import.meta.env.VITE_CHATKIT_DEFAULT_MODEL ?? "balanced";
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

const ATTACHMENT_LIMIT_ERROR_MESSAGE = "Cannot attach any more files to this message.";

const CHATKIT_COPY: Record<
  PreferredOutputLanguage,
  {
    greeting: string;
    placeholder: string;
    starterPrompts: readonly ChatKitStarterPrompt[];
  }
> = {
  hr: {
    greeting: "Pregledaj slike farme, provjeri spremljeni zapis i predloži sljedeći najbolji korak.",
    placeholder: "Zatraži od PlodAI-ja da pregleda slike, objasni zapis farme ili spremi promjene.",
    starterPrompts: [
      {
        label: "Procijeni slike polja",
        prompt:
          "Pregledaj trenutačne slike farme, sažmi što se vizualno najviše ističe i izdvoji najvažnija dodatna pitanja.",
        icon: "document",
      },
      {
        label: "Ažuriraj zapis farme",
        prompt:
          "Pregledaj spremljeni zapis farme i najnovije slike polja, pa predloži najvažnija ažuriranja zapisa prije bilo kakve promjene.",
        icon: "check-circle",
      },
      {
        label: "Pripremi narudžbe kupaca",
        prompt:
          "Pogledaj spremljene kulture i sastavi praktičan skup narudžbi farme koje bi se mogle sljedeće objaviti.",
        icon: "bolt",
      },
    ] as const,
  },
  en: {
    greeting: "Review farm images, inspect the saved record, and decide the next step.",
    placeholder: "Ask PlodAI to inspect images, explain the farm record, or save updates.",
    starterPrompts: [
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
    ] as const,
  },
};

function isDraftAttachmentLimitError(error: Error): boolean {
  return error.message.includes(ATTACHMENT_LIMIT_ERROR_MESSAGE);
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
  onClientEffect,
  headerTitle = "PlodAI chat",
  greeting,
  entitiesConfig,
  preferredOutputLanguage = "hr",
  showDictation = true,
  surfaceMinHeight,
  fillAvailableHeight = false,
  threadOrigin = "interactive",
}: {
  farmId: string | null;
  activeChatId?: string | null;
  onActiveChatChange?: (chatId: string | null) => Promise<void> | void;
  onClientEffect?: (effect: ChatKitClientEffect) => Promise<void> | void;
  headerTitle?: string;
  greeting?: string;
  entitiesConfig?: ChatKitEntityConfig;
  preferredOutputLanguage?: PreferredOutputLanguage;
  showDictation?: boolean;
  surfaceMinHeight?: number;
  fillAvailableHeight?: boolean;
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

  useEffect(() => {
    setChatKitOutputLanguageGetter(() => preferredOutputLanguage);
    return () => {
      setChatKitOutputLanguageGetter(null);
    };
  }, [preferredOutputLanguage]);

  return (
    <ChatKitPaneCard $fillHeight={fillAvailableHeight}>
      <ChatKitPaneHarness $fillHeight={fillAvailableHeight}>
        {!farmId ? (
          <ChatKitPaneSurface
            $fillHeight={fillAvailableHeight}
            $light
            $minHeight={surfaceMinHeight}
            data-testid="chatkit-surface"
          >
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
            onClientEffect={onClientEffect}
            preferredOutputLanguage={preferredOutputLanguage}
            showDictation={showDictation}
            surfaceMinHeight={surfaceMinHeight}
            fillAvailableHeight={fillAvailableHeight}
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
  onClientEffect,
  headerTitle,
  greeting,
  entitiesConfig,
  preferredOutputLanguage,
  showDictation,
  surfaceMinHeight,
  fillAvailableHeight,
}: {
  farmId: string;
  activeChatId?: string | null;
  onActiveChatChange?: (chatId: string | null) => Promise<void> | void;
  onClientEffect?: (effect: ChatKitClientEffect) => Promise<void> | void;
  headerTitle: string;
  greeting?: string;
  entitiesConfig?: ChatKitEntityConfig;
  preferredOutputLanguage: PreferredOutputLanguage;
  showDictation: boolean;
  surfaceMinHeight?: number;
  fillAvailableHeight: boolean;
}) {
  const threadIdRef = useRef<string | null>(activeChatId ?? null);
  const initialThreadRef = useRef<{
    farmId: string;
    threadId: string | null;
  }>({
    farmId,
    threadId: activeChatId ?? null,
  });
  const onActiveChatChangeRef = useRef(onActiveChatChange);
  const onClientEffectRef = useRef(onClientEffect);
  const chatKitRef = useRef<ReturnType<typeof useChatKit> | null>(null);

  if (initialThreadRef.current.farmId !== farmId) {
    initialThreadRef.current = {
      farmId,
      threadId: activeChatId ?? null,
    };
  }

  useEffect(() => {
    onActiveChatChangeRef.current = onActiveChatChange;
  }, [onActiveChatChange]);

  useEffect(() => {
    onClientEffectRef.current = onClientEffect;
  }, [onClientEffect]);

  const localizedCopy = CHATKIT_COPY[preferredOutputLanguage];
  const starterPrompts = useMemo(
    () => localizedCopy.starterPrompts,
    [localizedCopy],
  );
  const resolvedGreeting = greeting ?? localizedCopy.greeting;
  const composerPlaceholder = localizedCopy.placeholder;
  const chatKitConfig = useMemo(() => getChatKitConfig(farmId), [farmId]);
  const options = useMemo<UseChatKitOptions>(() => {
    return {
      api: {
        url: chatKitConfig.url,
        domainKey: chatKitConfig.domainKey,
        fetch: authenticatedFetch,
        uploadStrategy: {
          type: "two_phase",
        },
      },
      // Keep the initial thread stable for a farm instance. Later thread changes
      // should go through setThreadId so ChatKit does not reconfigure itself.
      initialThread: initialThreadRef.current.threadId,
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
        greeting: resolvedGreeting,
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
        placeholder: composerPlaceholder,
        attachments: {
          enabled: true,
          accept: {
            "image/png": [".png"],
            "image/jpeg": [".jpg", ".jpeg"],
            "image/webp": [".webp"],
          },
          maxSize: 10 * 1024 * 1024,
        },
        dictation: { enabled: showDictation },
        models: CHATKIT_MODEL_CHOICES.map((choice) => ({
          ...choice,
          default: choice.id === CHATKIT_DEFAULT_MODEL_ID,
        })),
      },
      onError: ({ error }) => {
        if (!isDraftAttachmentLimitError(error)) {
          return;
        }

        void chatKitRef.current?.setComposerValue({
          attachments: [],
        });
        publishToast({
          title: "Draft attachments reset",
          message: "Removed the stale draft attachments. Try attaching those files again.",
          tone: "warning",
        });
      },
      onThreadChange: ({ threadId: nextThreadId }) => {
        threadIdRef.current = nextThreadId;
        void onActiveChatChangeRef.current?.(nextThreadId ?? null);
      },
      onEffect: (effect) => {
        void onClientEffectRef.current?.(effect);
      },
    };
  }, [
    entitiesConfig,
    farmId,
    chatKitConfig,
    composerPlaceholder,
    headerTitle,
    resolvedGreeting,
    showDictation,
    starterPrompts,
  ]);

  const chatKit = useChatKit(options);
  chatKitRef.current = chatKit;

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
    <ChatKitPaneSurface
      $fillHeight={fillAvailableHeight}
      $light
      $minHeight={surfaceMinHeight}
      data-testid="chatkit-surface"
    >
      <ChatKit control={chatKit.control} />
    </ChatKitPaneSurface>
  );
}
