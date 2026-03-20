export interface Base64Codec {
  decode(base64: string): Uint8Array;
  encode(bytes: Uint8Array): string;
}

type Uint8ArrayConstructorWithBase64 = typeof Uint8Array & {
  fromBase64?: (base64: string) => Uint8Array;
};

type Uint8ArrayWithBase64Methods = Uint8Array & {
  toBase64?: () => string;
};

type BufferConstructorLike = {
  from(input: Uint8Array | string, encoding?: "base64" | "binary"): {
    toString(encoding: "base64" | "binary"): string;
  };
};

type GlobalBase64Scope = typeof globalThis & {
  atob?: (base64: string) => string;
  btoa?: (binary: string) => string;
  Buffer?: BufferConstructorLike;
};

const NO_BASE64_DECODER_ERROR =
  "No base64 decoder is available in this environment.";
const NO_BASE64_ENCODER_ERROR =
  "No base64 encoder is available in this environment.";

let codecOverride: Base64Codec | null = null;

export function setBase64CodecForTests(codec: Base64Codec | null): void {
  codecOverride = codec;
}

export function decodeBase64ToBytes(base64: string): Uint8Array {
  return (codecOverride ?? resolveDefaultBase64Codec()).decode(base64);
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
  return (codecOverride ?? resolveDefaultBase64Codec()).encode(bytes);
}

function resolveDefaultBase64Codec(): Base64Codec {
  return (
    resolveTypedArrayBase64Codec() ??
    resolveGlobalBase64Codec() ??
    resolveBufferBase64Codec() ??
    missingBase64Codec()
  );
}

function resolveTypedArrayBase64Codec(): Base64Codec | null {
  const uint8ArrayConstructor = Uint8Array as Uint8ArrayConstructorWithBase64;
  const fromBase64 = uint8ArrayConstructor.fromBase64;
  const toBase64 = (Uint8Array.prototype as Uint8ArrayWithBase64Methods).toBase64;
  if (typeof fromBase64 !== "function" || typeof toBase64 !== "function") {
    return null;
  }
  return {
    decode(base64) {
      return fromBase64(base64);
    },
    encode(bytes) {
      return (bytes as Uint8ArrayWithBase64Methods).toBase64!();
    },
  };
}

function resolveGlobalBase64Codec(): Base64Codec | null {
  const scope = globalThis as GlobalBase64Scope;
  if (typeof scope.atob !== "function" || typeof scope.btoa !== "function") {
    return null;
  }
  return {
    decode(base64) {
      return binaryStringToBytes(scope.atob!(base64));
    },
    encode(bytes) {
      return scope.btoa!(bytesToBinaryString(bytes));
    },
  };
}

function resolveBufferBase64Codec(): Base64Codec | null {
  const scope = globalThis as GlobalBase64Scope;
  if (!scope.Buffer) {
    return null;
  }
  return {
    decode(base64) {
      return binaryStringToBytes(
        scope.Buffer!.from(base64, "base64").toString("binary"),
      );
    },
    encode(bytes) {
      return scope.Buffer!.from(bytes).toString("base64");
    },
  };
}

function missingBase64Codec(): Base64Codec {
  return {
    decode() {
      throw new Error(NO_BASE64_DECODER_ERROR);
    },
    encode() {
      throw new Error(NO_BASE64_ENCODER_ERROR);
    },
  };
}

function binaryStringToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return binary;
}
