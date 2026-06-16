/**
 * One-time setup script: uploads AeliusCase_User_Guide.docx to OpenAI
 * and creates an OpenAI Vector Store for RAG queries.
 *
 * Usage:
 *   npm run setup:kb
 *
 * After running, copy the printed OPENAI_VECTOR_STORE_ID into your .env.local.
 */
import OpenAI from 'openai';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('ERROR: OPENAI_API_KEY is not set in the environment.');
    console.error('Tip: set it in your shell before running:  export OPENAI_API_KEY=sk-...');
    process.exit(1);
  }

  const docPath = join(process.cwd(), 'AeliusCase_User_Guide.docx');
  if (!existsSync(docPath)) {
    console.error(`ERROR: File not found: ${docPath}`);
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey });

  // ── Step 1: Upload the DOCX to OpenAI Files ──────────────────────────────
  console.log('Uploading AeliusCase_User_Guide.docx to OpenAI Files...');
  const uploadedFile = await openai.files.create({
    file: createReadStream(docPath),
    purpose: 'assistants',
  });
  console.log(`File uploaded: ${uploadedFile.id}`);

  // ── Step 2: Create a Vector Store and attach the file ────────────────────
  console.log('Creating OpenAI Vector Store...');
  const vectorStore = await openai.vectorStores.create({
    name: 'AeliusCase User Guide',
    file_ids: [uploadedFile.id],
  });
  console.log(`Vector Store created: ${vectorStore.id}`);

  // ── Step 3: Poll until OpenAI finishes indexing the file ─────────────────
  console.log('Waiting for file indexing to complete...');
  let store = vectorStore;
  let attempts = 0;
  const maxAttempts = 40; // 40 × 3 s = ~2 minutes max

  while (store.file_counts.in_progress > 0 && attempts < maxAttempts) {
    await new Promise<void>((r) => setTimeout(r, 3000));
    store = await openai.vectorStores.retrieve(vectorStore.id);
    attempts++;
    console.log(
      `  attempt ${attempts}/${maxAttempts} — in_progress=${store.file_counts.in_progress}  completed=${store.file_counts.completed}  failed=${store.file_counts.failed}`,
    );
  }

  if (store.file_counts.failed > 0) {
    console.warn(`\nWARNING: ${store.file_counts.failed} file(s) failed to be indexed.`);
  }

  if (store.file_counts.completed === 0) {
    console.error('\nERROR: No files were successfully indexed.');
    console.error('Check the OpenAI dashboard for details.');
    process.exit(1);
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  console.log('\n✅  Knowledge base setup complete!');
  console.log('\nAdd the following line to your .env.local:\n');
  console.log(`OPENAI_VECTOR_STORE_ID=${vectorStore.id}`);
  console.log(`\n(OpenAI File ID for reference: ${uploadedFile.id})`);
}

main().catch((err: unknown) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
