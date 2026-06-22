import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { gunzipSync } from "zlib";

const client = new S3Client({
  endpoint: "https://files.massive.com",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.MASSIVE_KEY_ID?.trim(),
    secretAccessKey: process.env.MASSIVE_ACCESS_KEY?.trim(),
  },
  forcePathStyle: true,
});

const key = "us_stocks_sip/minute_aggs_v1/2010/03/2010-03-01.csv.gz";
console.log("Fetching", key, "...");

const res = await client.send(new GetObjectCommand({ Bucket: "flatfiles", Key: key }));
const bytes = await res.Body.transformToByteArray();
const text = gunzipSync(bytes).toString("utf8");
const lines = text.split("\n");

console.log("\nHeader:", lines[0]);
console.log("First data row:", lines[1]);

const tqqqRows = lines.filter(l => l.includes(",TQQQ,") || l.startsWith("TQQQ,"));
console.log(`\nTQQQ rows: ${tqqqRows.length}`);
console.log("First 3:", tqqqRows.slice(0, 3));
console.log("Total lines:", lines.length.toLocaleString());
