import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const targetDir = path.resolve('public/sample-workspace/media');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// 1. Generate a valid WAV file (44.1kHz, 16-bit PCM, 2 seconds pleasant chord)
function createWavBuffer(durationSec = 2) {
  const sampleRate = 44100;
  const numChannels = 1;
  const bytesPerSample = 2;
  const numSamples = sampleRate * durationSec;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Sine wave chord (440Hz + 554.37Hz + 659.25Hz = A major)
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const env = Math.sin(Math.PI * (i / numSamples)); // smooth bell envelope
    const s1 = Math.sin(2 * Math.PI * 440 * t);
    const s2 = Math.sin(2 * Math.PI * 554.37 * t);
    const s3 = Math.sin(2 * Math.PI * 659.25 * t);
    const sample = Math.round(32767 * 0.25 * env * (s1 + s2 + s3));
    buffer.writeInt16LE(sample, offset);
    offset += 2;
  }
  return buffer;
}

const wavBuf = createWavBuffer(3);
fs.writeFileSync(path.join(targetDir, 'lecture-audio.wav'), wavBuf);
console.log('Created lecture-audio.wav');

// 2. Generate a valid PPTX with 3 slides using JSZip
async function createSamplePptx() {
  const zip = new JSZip();

  // [Content_Types].xml
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>
</Types>`);

  // _rels/.rels
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);

  // ppt/presentation.xml
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
    <p:sldId id="257" r:id="rId2"/>
    <p:sldId id="258" r:id="rId3"/>
  </p:sldIdLst>
</p:presentation>`);

  // ppt/_rels/presentation.xml.rels
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>
</Relationships>`);

  // Slide 1: Welcome & Overview
  zip.file('ppt/slides/slide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:txBody>
          <a:bodyPr/>
          <a:p><a:r><a:rPr b="1"/><a:t>ReadSpace Presentation Deck</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Body"/><p:nvPr/></p:nvSpPr>
        <p:txBody>
          <a:bodyPr/>
          <a:p><a:r><a:t>Welcome to ReadSpace native document and media reader</a:t></a:r></a:p>
          <a:p><a:r><a:t>Supports Markdown, PDF, DOCX, Code, Audio, Video &amp; Slides</a:t></a:r></a:p>
          <a:p><a:r><a:t>Pure client-side zero-latency rendering with offline support</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`);

  // Slide 1 notes
  zip.file('ppt/notesSlides/notesSlide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:p><a:r><a:t>Welcome attendees. Emphasize that all files are rendered client-side with no privacy compromises.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`);

  // Slide 2: Core Architecture
  zip.file('ppt/slides/slide2.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:txBody>
          <a:bodyPr/>
          <a:p><a:r><a:rPr b="1"/><a:t>Architecture &amp; Features</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Body"/><p:nvPr/></p:nvSpPr>
        <p:txBody>
          <a:bodyPr/>
          <a:p><a:r><a:rPr b="1"/><a:t>Background Audio Engine</a:t></a:r></a:p>
          <a:p><a:pPr lvl="1"/><a:r><a:t>Allows listening to lectures while switching between tabs</a:t></a:r></a:p>
          <a:p><a:r><a:rPr b="1"/><a:t>Rich Video Player</a:t></a:r></a:p>
          <a:p><a:pPr lvl="1"/><a:r><a:t>Interactive scrubber, speed controls, PiP, and fullscreen</a:t></a:r></a:p>
          <a:p><a:r><a:rPr b="1"/><a:t>Centered PDF Canvas</a:t></a:r></a:p>
          <a:p><a:pPr lvl="1"/><a:r><a:t>Pages maintain horizontal alignment at all zoom scales (40% - 400%)</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`);

  // Slide 3: Conclusion & Next Steps
  zip.file('ppt/slides/slide3.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:txBody>
          <a:bodyPr/>
          <a:p><a:r><a:rPr b="1"/><a:t>Seamless Learning Experience</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Body"/><p:nvPr/></p:nvPr>
        <p:txBody>
          <a:bodyPr/>
          <a:p><a:r><a:t>Organize lecture notes, research slides, and media files in one place</a:t></a:r></a:p>
          <a:p><a:r><a:t>Press F5 or click Present to enter presentation mode</a:t></a:r></a:p>
          <a:p><a:r><a:t>Enjoy study and reading with ReadSpace!</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`);

  const pptxBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(path.join(targetDir, 'ai-overview.pptx'), pptxBuffer);
  console.log('Created ai-overview.pptx');
}

await createSamplePptx();
