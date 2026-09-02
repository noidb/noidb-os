declare module "bwip-js" {
  interface RenderOptions {
    bcid: string;
    text: string;
    scale?: number;
    height?: number;
    includetext?: boolean;
    textxalign?: string;
    textsize?: number;
    paddingwidth?: number;
    paddingheight?: number;
  }

  const bwipjs: {
    toCanvas(canvas: HTMLCanvasElement, options: RenderOptions): HTMLCanvasElement;
  };

  export default bwipjs;
}
