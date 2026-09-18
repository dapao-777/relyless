import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { env, pipeline } from '@huggingface/transformers';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT = join(ROOT, 'extension/local-inference');
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const MODEL_REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';
const MODEL_ROOT = join(OUTPUT, 'models');
const MODEL_DIR = join(MODEL_ROOT, MODEL_ID);

const MODEL_FILES = Object.freeze({
  'config.json': '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7',
  'tokenizer.json': 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0',
  'tokenizer_config.json': '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3',
  'special_tokens_map.json': 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3',
  'vocab.txt': '07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3',
  'onnx/model_quantized.onnx': 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1',
});

const PROTOTYPES = Object.freeze({
  tech: [
    'Software engineering documentation about APIs, programming languages, source code, debugging, testing, deployment, distributed systems, and cloud infrastructure.',
    'A developer guide explaining functions, classes, command line tools, repositories, package dependencies, databases, networking, and application architecture.',
    'Technical discussion of operating systems, compilers, containers, Kubernetes, web frameworks, security vulnerabilities, and performance optimization.',
    'Release notes and engineering tutorials for building, configuring, monitoring, or troubleshooting computer software and hardware.',
  ],
  data: [
    'Data engineering and analytics covering datasets, ETL pipelines, warehouses, lakehouses, schemas, SQL queries, metrics, and business intelligence dashboards.',
    'Machine learning and statistics about training data, features, classification, regression, embeddings, experiments, evaluation metrics, and model inference.',
    'A research analysis using probability, sampling, causal inference, visualization, data quality, governance, and quantitative measurement.',
    'Documentation for Spark, Flink, Hadoop, data catalogs, streaming events, batch processing, vector databases, and analytical workloads.',
  ],
  finance: [
    'Financial markets and investing including stocks, bonds, funds, portfolio allocation, earnings, valuation, interest rates, currencies, and economic indicators.',
    'Corporate finance reporting about revenue, profit, cash flow, balance sheets, accounting, taxation, budgets, audits, and capital expenditure.',
    'Banking, lending, insurance, mortgages, credit risk, monetary policy, inflation, securities trading, and shareholder returns.',
    'An investor report discussing quarterly results, guidance, dividends, market capitalization, assets, liabilities, and return on investment.',
  ],
  medical: [
    'Clinical medicine and health information about symptoms, diagnosis, treatment, patients, diseases, medication, surgery, and medical tests.',
    'Biomedical research discussing anatomy, physiology, pathology, epidemiology, clinical trials, therapies, vaccines, and public health.',
    'Healthcare guidance involving physicians, hospitals, dosage, adverse effects, mental health, nutrition, rehabilitation, and patient care.',
    'A scientific medical article about cancer, infection, cardiovascular disease, immune response, biomarkers, and treatment outcomes.',
  ],
  legal: [
    'Legal analysis of statutes, regulations, court decisions, judges, lawsuits, contracts, liability, evidence, and judicial precedent.',
    'A contract or policy describing parties, obligations, warranties, intellectual property, privacy, compliance, termination, and governing law.',
    'Litigation and legal procedure involving plaintiffs, defendants, appeals, constitutional rights, criminal charges, and administrative rules.',
    'Professional legal advice about employment law, data protection, licensing, patents, enforcement, damages, and regulatory requirements.',
  ],
  design: [
    'Product and user experience design about interfaces, usability, typography, color, layout, interaction patterns, accessibility, and design systems.',
    'Visual design critique covering composition, hierarchy, spacing, grids, icons, branding, illustration, prototypes, and responsive screens.',
    'A designer workflow using Figma, wireframes, user research, personas, journey maps, component libraries, and usability testing.',
    'Architecture and industrial design discussion of form, materials, aesthetics, spatial experience, sketches, and creative direction.',
  ],
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fetchPinnedModel() {
  for (const [file, expected] of Object.entries(MODEL_FILES)) {
    const output = join(MODEL_DIR, file);
    let bytes;
    try {
      bytes = await readFile(output);
    } catch {
      const url = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/${file}`;
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`下载 ${file} 失败：HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    const actual = sha256(bytes);
    if (actual !== expected) throw new Error(`${file} SHA-256 不匹配：${actual}`);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, bytes);
  }
}

async function copyRuntime() {
  const transformerDist = join(ROOT, 'node_modules/@huggingface/transformers/dist');
  const runtimeDir = join(OUTPUT, 'runtime');
  await rm(runtimeDir, { recursive: true, force: true });
  await mkdir(runtimeDir, { recursive: true });
  await Promise.all([
    copyFile(join(transformerDist, 'transformers.min.js'), join(runtimeDir, 'transformers.min.js')),
    copyFile(join(transformerDist, 'ort-wasm-simd-threaded.jsep.wasm'), join(runtimeDir, 'ort-wasm-simd-threaded.jsep.wasm')),
    copyFile(join(transformerDist, 'ort-wasm-simd-threaded.jsep.mjs'), join(runtimeDir, 'ort-wasm-simd-threaded.jsep.mjs')),
  ]);
}

async function buildPrototypeEmbeddings() {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = `${MODEL_ROOT}/`;
  env.useBrowserCache = false;
  const extractor = await pipeline('feature-extraction', MODEL_ID, { device: 'cpu', dtype: 'q8' });
  const entries = [];
  for (const [domain, descriptions] of Object.entries(PROTOTYPES)) {
    const tensor = await extractor(descriptions, { pooling: 'mean', normalize: true });
    const vectors = tensor.tolist();
    entries.push({ domain, vectors });
  }
  await extractor.dispose();
  await writeFile(join(OUTPUT, 'domain-prototypes.json'), `${JSON.stringify({
    model: MODEL_ID,
    revision: MODEL_REVISION,
    dimensions: entries[0].vectors[0].length,
    entries,
  })}\n`);
}

async function writeNotices() {
  const noticeDir = join(OUTPUT, 'third-party');
  await mkdir(noticeDir, { recursive: true });
  await copyFile(join(ROOT, 'node_modules/@huggingface/transformers/LICENSE'), join(noticeDir, 'APACHE-2.0.txt'));
  await writeFile(join(noticeDir, 'NOTICES.txt'), [
    'RelyLess local inference third-party notices',
    '',
    '@huggingface/transformers 3.7.3 — Apache License 2.0',
    'Copyright 2023 Hugging Face, Inc.',
    'https://github.com/huggingface/transformers.js',
    '',
    'ONNX Runtime Web 1.22.0-dev.20250409-89f8206ba4 — MIT License',
    'Copyright (c) Microsoft Corporation.',
    'https://github.com/microsoft/onnxruntime',
    '',
    'Xenova/all-MiniLM-L6-v2 revision 751bff37182d3f1213fa05d7196b954e230abad9',
    'Apache License 2.0; derived from sentence-transformers/all-MiniLM-L6-v2.',
    'https://huggingface.co/Xenova/all-MiniLM-L6-v2',
    '',
  ].join('\n'));
  await writeFile(join(noticeDir, 'ONNXRUNTIME-MIT.txt'), `MIT License\n\nCopyright (c) Microsoft Corporation.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`);
}

await mkdir(OUTPUT, { recursive: true });
await fetchPinnedModel();
await copyRuntime();
await buildPrototypeEmbeddings();
await writeNotices();

let total = 0;
for (const file of Object.keys(MODEL_FILES)) total += (await stat(join(MODEL_DIR, file))).size;
console.log(`本地模型构建完成：${(total / 1024 / 1024).toFixed(1)} MiB，revision ${MODEL_REVISION}`);
