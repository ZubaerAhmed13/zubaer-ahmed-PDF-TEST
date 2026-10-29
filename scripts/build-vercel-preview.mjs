import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
const output=new URL('../preview-public/',import.meta.url),base='zubaer-ahmed-PDF-TEST/';
await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
await cp(new URL('../dist/',import.meta.url),new URL(base,output),{recursive:true});
await writeFile(new URL('index.html',output),'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=/'+base+'"><title>DocFlow 2.0 preview</title></head><body><p><a href="/'+base+'">Open DocFlow 2.0 preview</a></p></body></html>');
const release=JSON.parse(await readFile(new URL(base+'release.json',output),'utf8'));
console.log('Packaged DocFlow preview at /'+base+' · '+release.build);
