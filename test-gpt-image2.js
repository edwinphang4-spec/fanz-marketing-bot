// ============================================
// test-gpt-image2.js — GPT Image 2 场景图生成测试
// 用 OpenAI images.edit 以输入参考图 + prompt 生成场景
// 不改 lib/scene-gen.js，纯测试
//
// Run: cd /root/fanz-bots/marketing-bot && railway run node test-gpt-image2.js
// ============================================
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const PRODUCT_IMAGE = path.join(__dirname, 'assets', 'products', 'fanz-product-test.png');
const OUTPUT_PATH = '/tmp/gpt-image2-test-output.png';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function testGptImage2() {
  console.log('=== GPT Image 2 场景图生成测试 ===\n');

  // Check prerequisites
  if (!fs.existsSync(PRODUCT_IMAGE)) {
    console.error(`ERROR: Product image not found: ${PRODUCT_IMAGE}`);
    process.exit(1);
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY not set.');
    console.error('Run with: railway run node test-gpt-image2.js');
    process.exit(1);
  }

  const stats = fs.statSync(PRODUCT_IMAGE);
  console.log(`Product image: ${PRODUCT_IMAGE}`);
  console.log(`Image size: ${(stats.size / 1024).toFixed(1)} KB`);
  console.log(`OPENAI_API_KEY set: ${!!process.env.OPENAI_API_KEY}\n`);

  const prompt = 'Keep the ceiling fan in this image exactly as it is — same blades, same shape, same color, same number of blades. Replace only the background with a modern Malaysian living room scene. Bright, airy room with warm natural lighting, clean walls, comfortable furniture. The fan should appear naturally mounted on the ceiling of this room. Photorealistic style.';

  console.log('Prompt:');
  console.log(`  "${prompt}"\n`);
  console.log(`Model: gpt-image-2`);
  console.log(`Size: 1024x1024`);
  console.log(`Quality: low (test mode)\n`);

  // OpenAI's images.edit needs proper MIME type detection
  // Convert to proper File or use Buffer with explicit name
  const imageBuffer = fs.readFileSync(PRODUCT_IMAGE);
  
  // Use a proper filename to help MIME detection
  const imageFile = new File([imageBuffer], 'fanz-product-test.png', { type: 'image/png' });

  console.log('Calling OpenAI images.edit...');
  const start = Date.now();

  try {
    const response = await openai.images.edit({
      model: 'gpt-image-2',
      image: imageFile,
      prompt: prompt,
      size: '1024x1024',
      quality: 'low',
      n: 1,
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nDone in ${elapsed}s`);

    // Check response
    if (!response.data || response.data.length === 0) {
      console.log('\nRESULT: FAILED — no data returned');
      process.exit(1);
    }

    const firstResult = response.data[0];
    let imageBuffer = null;

    if (firstResult.b64_json) {
      imageBuffer = Buffer.from(firstResult.b64_json, 'base64');
      console.log('Response format: b64_json');
    } else if (firstResult.url) {
      console.log(`Response format: url -> ${firstResult.url}`);
      console.log('Downloading...');
      const imgResp = await fetch(firstResult.url);
      if (!imgResp.ok) {
        throw new Error(`Failed to download image: ${imgResp.status}`);
      }
      imageBuffer = Buffer.from(await imgResp.arrayBuffer());
    } else {
      console.log('\nRESULT: FAILED — unexpected response format');
      console.log(JSON.stringify(firstResult, null, 2));
      process.exit(1);
    }

    fs.writeFileSync(OUTPUT_PATH, imageBuffer);

    console.log(`\nRESULT: SUCCESS`);
    console.log(`Output size: ${(imageBuffer.length / 1024).toFixed(1)} KB`);
    console.log(`Saved to: ${OUTPUT_PATH}`);

    // Write marker
    fs.writeFileSync('/tmp/gpt-image2-result.txt',
      `SUCCESS\n${OUTPUT_PATH}\n${elapsed}s\n${(imageBuffer.length / 1024).toFixed(1)} KB`);

  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nDone in ${elapsed}s`);

    console.log(`\nRESULT: FAILED`);
    console.log(`Error message: ${err.message}`);

    if (err.status) console.log(`HTTP Status: ${err.status}`);
    if (err.code) console.log(`Error code: ${err.code}`);
    if (err.type) console.log(`Error type: ${err.type}`);

    console.log(`\nFull error:`);
    console.log(JSON.stringify(err, Object.getOwnPropertyNames(err), 2).slice(0, 3000));

    fs.writeFileSync('/tmp/gpt-image2-result.txt',
      `FAILED\n${err.message}\n${err.status || 'N/A'}\n${err.code || 'N/A'}\n${err.type || 'N/A'}`);

    process.exit(1);
  }
}

testGptImage2();
