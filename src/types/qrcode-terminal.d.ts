declare module "qrcode-terminal" {
  interface GenerateOptions {
    small?: boolean;
  }

  interface QRCodeTerminal {
    generate(input: string, options?: GenerateOptions, callback?: (qrcode: string) => void): void;
  }

  const qrcode: QRCodeTerminal;
  export default qrcode;
}
