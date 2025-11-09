import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Worker } from 'worker_threads';
import ffmpeg from 'fluent-ffmpeg';
import { SharpenMode } from './ImageProcessor';

interface VideoInfo {
  width: number;
  height: number;
  fps: number;
  duration: number;
}

async function getVideoInfo(inputPath: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      if (!videoStream) {
        reject(new Error('No video stream found'));
        return;
      }

      const fps = videoStream.r_frame_rate
        ? eval(videoStream.r_frame_rate)
        : 30;

      resolve({
        width: videoStream.width || 0,
        height: videoStream.height || 0,
        fps: fps,
        duration: metadata.format.duration || 0
      });
    });
  });
}

async function extractFrames(
  inputPath: string,
  tempDir: string,
  videoInfo: VideoInfo
): Promise<number> {
  return new Promise((resolve, reject) => {
    let frameCount = 0;

    // Extract frames at original resolution and FPS
    // No filters applied to maintain exact input dimensions
    ffmpeg(inputPath)
      .output(path.join(tempDir, 'frame-%06d.png'))
      .on('progress', (progress) => {
        if (progress.frames) {
          frameCount = progress.frames;
        }
      })
      .on('end', () => {
        console.log(`✓ Extracted ${frameCount} frames`);
        resolve(frameCount);
      })
      .on('error', (err) => {
        reject(err);
      })
      .run();
  });
}

async function processFrames(
  tempDir: string,
  frameCount: number,
  videoInfo: VideoInfo,
  blurRadius: number,
  sharpenStrength: number,
  sharpenMode: SharpenMode,
  numIterations: number
): Promise<void> {
  const maxWorkers = os.cpus().length;
  // Reference the compiled .js file from TypeScript source
  const workerScript = path.join(__dirname, 'frame-worker.js');

  console.log(`\n🔧 Processing ${frameCount} frames with ${maxWorkers} parallel workers...`);
  console.log(`   Settings: blur=${blurRadius}, sharpen=${sharpenStrength}, mode=${sharpenMode}, iterations=${numIterations}`);

  let processedCount = 0;
  let activeWorkers = 0;
  const frameQueue: number[] = [];

  // Build queue of frames to process
  for (let i = 1; i <= frameCount; i++) {
    const framePath = path.join(tempDir, `frame-${String(i).padStart(6, '0')}.png`);
    if (fs.existsSync(framePath)) {
      frameQueue.push(i);
    }
  }

  const startTime = Date.now();
  let lastProgressUpdate = startTime;

  return new Promise((resolve, reject) => {
    const processNextFrame = () => {
      if (frameQueue.length === 0) {
        if (activeWorkers === 0) {
          resolve();
        }
        return;
      }

      const frameNum = frameQueue.shift()!;
      const framePath = path.join(tempDir, `frame-${String(frameNum).padStart(6, '0')}.png`);

      activeWorkers++;

      const worker = new Worker(workerScript, {
        workerData: {
          framePath,
          blurRadius,
          sharpenStrength,
          sharpenMode,
          numIterations,
          // To create the effect where a video gradually transitions into a Turing Pattern, use the below line
          //numIterations: Math.max(0, Math.min(20, frameNum - 30 * 9)),
          width: videoInfo.width,
          height: videoInfo.height
        }
      });

      worker.on('message', (message) => {
        activeWorkers--;
        processedCount++;

        if (message.success) {
          // Update progress every 1 second or every frame if there are few frames
          const now = Date.now();
          if (now - lastProgressUpdate >= 1000 || frameCount < 100) {
            const elapsed = (now - startTime) / 1000;
            const framesPerSecond = processedCount / elapsed;
            const remainingFrames = frameCount - processedCount;
            const estimatedTimeRemaining = remainingFrames / framesPerSecond;

            const minutes = Math.floor(estimatedTimeRemaining / 60);
            const seconds = Math.floor(estimatedTimeRemaining % 60);

            console.log(`   Progress: ${processedCount}/${frameCount} (${(processedCount/frameCount*100).toFixed(1)}%) - ${framesPerSecond.toFixed(2)} fps - ETA: ${minutes}m ${seconds}s`);
            lastProgressUpdate = now;
          }
        } else {
          console.error(`   ✗ Error processing frame ${frameNum}:`, message.error);
        }

        worker.terminate();
        processNextFrame();
      });

      worker.on('error', (error) => {
        activeWorkers--;
        console.error(`   ✗ Worker error on frame ${frameNum}:`, error);
        worker.terminate();
        processNextFrame();
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`   ✗ Worker stopped with exit code ${code}`);
        }
      });
    };

    // Start workers
    for (let i = 0; i < maxWorkers && i < frameQueue.length; i++) {
      processNextFrame();
    }
  });
}

async function reassembleVideo(
  tempDir: string,
  outputPath: string,
  inputPath: string,
  videoInfo: VideoInfo
): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    // Add processed frames as input at original FPS
    command.input(path.join(tempDir, 'frame-%06d.png'))
      .inputFPS(videoInfo.fps);

    // Add original video as input for audio
    command.input(inputPath);

    // Map video from first input and audio from second input
    // Output at original resolution (no scaling)
    command.outputOptions([
      '-map', '0:v:0',  // Video from first input (processed frames)
      '-map', '1:a:0?', // Audio from second input (original video), ? makes it optional
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-c:a', 'copy',   // Copy audio without re-encoding
      '-pix_fmt', 'yuv420p',
      '-r', videoInfo.fps.toString()  // Maintain original FPS
    ]);

    command.output(outputPath)
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`   Encoding: ${progress.percent.toFixed(1)}% done`);
        }
      })
      .on('end', () => {
        console.log('✓ Video reassembly complete');
        resolve();
      })
      .on('error', (err) => {
        reject(err);
      })
      .run();
  });
}

export async function processVideoWithFilter(
  inputPath: string,
  outputPath: string,
  blurRadius: number,
  sharpenStrength: number,
  sharpenMode: SharpenMode,
  numIterations: number
): Promise<void> {
  const overallStartTime = Date.now();
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║          Video to Turing Pattern Processing                   ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-processing-'));

  try {
    // Step 1: Get video info
    console.log('📹 Getting video info...');
    console.time('⏱️  Video info');
    const videoInfo = await getVideoInfo(inputPath);
    console.timeEnd('⏱️  Video info');
    console.log(`   Resolution: ${videoInfo.width}x${videoInfo.height}`);
    console.log(`   FPS: ${videoInfo.fps.toFixed(2)}`);
    console.log(`   Duration: ${videoInfo.duration.toFixed(2)}s`);

    // Step 2: Extract frames
    console.log('\n📤 Extracting frames (preserving original resolution)...');
    console.time('⏱️  Frame extraction');
    const frameCount = await extractFrames(inputPath, tempDir, videoInfo);
    console.timeEnd('⏱️  Frame extraction');

    // Step 3: Process frames
    console.time('⏱️  Frame processing');
    await processFrames(
      tempDir,
      frameCount,
      videoInfo,
      blurRadius,
      sharpenStrength,
      sharpenMode,
      numIterations
    );
    console.timeEnd('⏱️  Frame processing');
    console.log(`✓ All ${frameCount} frames processed`);

    // Step 4: Reassemble video
    console.log('\n🎬 Reassembling video...');
    console.time('⏱️  Video reassembly');
    await reassembleVideo(tempDir, outputPath, inputPath, videoInfo);
    console.timeEnd('⏱️  Video reassembly');

  } finally {
    // Clean up temporary directory
    console.log('\n🧹 Cleaning up temporary files...');
    console.time('⏱️  Cleanup');
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.timeEnd('⏱️  Cleanup');
  }

  const overallEndTime = Date.now();
  const totalSeconds = (overallEndTime - overallStartTime) / 1000;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = Math.floor(totalSeconds % 60);

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    Processing Complete! 🎉                     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`\n⏱️  Total time: ${totalMinutes}m ${remainingSeconds}s (${totalSeconds.toFixed(1)}s)`);
  console.log(`📁 Output saved to: ${outputPath}\n`);
}
