import { processVideoWithFilter } from './video-utils-node';
import { SharpenMode } from './ImageProcessor';
import { ImageData } from '@napi-rs/canvas';
import * as fs from 'fs';

(global as any).ImageData = ImageData;

interface VideoProcessingOptions {
  inputPath: string;
  outputPath: string;
  blurRadius: number;
  sharpenStrength: number;
  sharpenMode: SharpenMode;
  numIterations: number;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 6) {
    console.error('Usage: node process-video.js <inputPath> <outputPath> <blurRadius> <sharpenStrength> <sharpenMode> <numIterations>');
    console.error('Example: node process-video.js input.mp4 output.mp4 2 0.5 rgb 3');
    process.exit(1);
  }

  const options: VideoProcessingOptions = {
    inputPath: args[0],
    outputPath: args[1],
    blurRadius: parseFloat(args[2]),
    sharpenStrength: parseFloat(args[3]),
    sharpenMode: args[4] as SharpenMode,
    numIterations: parseInt(args[5], 10)
  };

  if (!fs.existsSync(options.inputPath)) {
    console.error(`Error: Input file not found: ${options.inputPath}`);
    process.exit(1);
  }

  if (options.sharpenMode !== 'rgb' && options.sharpenMode !== 'lab') {
    console.error('Error: sharpenMode must be either "rgb" or "lab"');
    process.exit(1);
  }

  console.log('Processing video with options:', options);

  try {
    await processVideoWithFilter(
      options.inputPath,
      options.outputPath,
      options.blurRadius,
      options.sharpenStrength,
      options.sharpenMode,
      options.numIterations
    );

    console.log('✓ Video processing complete!');
    console.log(`Output saved to: ${options.outputPath}`);
  } catch (error) {
    console.error('Error processing video:', error);
    process.exit(1);
  }
}

main().catch(console.error);
