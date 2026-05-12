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
    greeting: "Zatraži provjerene smjernice, prijavi problem s terena ili pronađi sljedeći praktičan korak.",
    placeholder: "Zatraži savjet, prijavi simptome ili štetu, ili pitaj gdje nabaviti materijal.",
    starterPrompts: [
      {
        label: "Zatraži smjernice",
        prompt:
          "Pomozi mi razjasniti poljoprivredno pitanje. Ako je potrebna javna ili službena informacija, pronađi izvore i jasno odvoji sigurne činjenice od pretpostavki.",
        icon: "document",
      },
      {
        label: "Prijavi problem",
        prompt:
          "Pomozi mi zabilježiti problem s terena kao strukturiranu prijavu: kultura ili stoka, lokacija, datum, ozbiljnost, opis, fotografije i što je već poduzeto.",
        icon: "check-circle",
      },
      {
        label: "Pronađi materijale",
        prompt:
          "Na temelju spremljenog zapisa i trenutnog problema, predloži koje materijale treba provjeriti i gdje tražiti službeno odobrene ili lokalno dostupne opcije.",
        icon: "bolt",
      },
    ] as const,
  },
  en: {
    greeting: "Request verified guidance, report a field issue, or find the next practical step.",
    placeholder: "Ask for advice, report symptoms or damage, or ask where to source materials.",
    starterPrompts: [
      {
        label: "Request guidance",
        prompt:
          "Help me clarify an agricultural question. If public or official information is needed, find sources and clearly separate known facts from assumptions.",
        icon: "document",
      },
      {
        label: "Report an issue",
        prompt:
          "Help me record a field problem as a structured report: crop or livestock, location, date, severity, description, photos, and what has already been tried.",
        icon: "check-circle",
      },
      {
        label: "Find materials",
        prompt:
          "Based on the saved record and current problem, suggest which materials to check and where to look for officially approved or locally available options.",
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
  caseId,
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
  caseId: string | null;
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
        {!caseId ? (
          <ChatKitPaneSurface
            $fillHeight={fillAvailableHeight}
            $light
            $minHeight={surfaceMinHeight}
            data-testid="chatkit-surface"
          >
            <ChatKitPaneEmpty>Select or create an advisory case to start chatting with PlodAI.</ChatKitPaneEmpty>
          </ChatKitPaneSurface>
        ) : (
          <ActiveCaseChatKit
            activeChatId={activeChatId}
            entitiesConfig={entitiesConfig}
            caseId={caseId}
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

function ActiveCaseChatKit({
  caseId,
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
  caseId: string;
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
    caseId: string;
    threadId: string | null;
  }>({
    caseId,
    threadId: activeChatId ?? null,
  });
  const onActiveChatChangeRef = useRef(onActiveChatChange);
  const onClientEffectRef = useRef(onClientEffect);
  const chatKitRef = useRef<ReturnType<typeof useChatKit> | null>(null);

  if (initialThreadRef.current.caseId !== caseId) {
    initialThreadRef.current = {
      caseId,
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
  const chatKitConfig = useMemo(() => getChatKitConfig(caseId), [caseId]);
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
      // Keep the initial thread stable for an advisory case instance. Later thread changes
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
    caseId,
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
