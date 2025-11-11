# Video to Turing Pattern

This is a quick and dirty script I made to create turing pattern videos for my [YouTube video](https://www.youtube.com/watch?v=7oCtDGOSgG8) on the subject. Node is the wrong choice for a project like this, however, it's what I'm most comfortable working with and I knew I could make the script fairly quickly. If you opt to use this, just know that it's very, very slow.

This script was made for small videos (less than 15 seconds).

## Usage

Being able to run this requires some knowledge of the command line, NodeJS, and git. You'll need [git](https://git-scm.com/install/) and [node](https://nodejs.org/en) installed for it to run.

1) Clone the project:

```
git clone git@github.com:patorjk/video-to-turing-pattern.git
```

2) Build the project:

```
cd video-to-turing-pattern
npm ci
npm run build
```

3) Run it like this:

```
node dist/process-video.js your-file.mp4 output.mp4 6 3 lab 200
```

Here's an explanation of the input args:

```
node dist/process-video.js <inputPath> <outputPath> <blurRadius> <sharpenStrength> <sharpenMode> <numIterations>

inputPath = Path to video.
outputPath = Path to video you want to create.
blurRadius = Strength of blur.
sharpenStrength = Strength of sharpen.
sharpenMode = lab or rgb (these are color spaces). If you want a black and white image, use lab. Sharpening in rgb can cause color artifacts.
numIterations = Number of times to do a blur/sharpen set of operations.
```

I found on my system that going over 200 iterations can cause problems, if a file needed more than 200 iterations, I would re-run the script on an output file. And if it needed more than that, re-run it on the second output file.
