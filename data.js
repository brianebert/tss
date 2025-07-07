import * as Block from 'multiformats/block'
import {CID} from 'multiformats/cid';
import * as cbor from '@ipld/dag-cbor';
import * as json from '@ipld/dag-json';
import * as pb from '@ipld/dag-pb';
import * as raw from 'multiformats/codecs/raw';
import { sha256 as hasher } from 'multiformats/hashes/sha2';
import { UnixFS } from 'ipfs-unixfs';
import {SetOf} from './cache.js';
import {mfdOpts, request} from './http.js';
import * as sodium from './na.js';

const BLOCK_SIZE = 262144; // 2**18
const DEBUG = true;

class IPFS_Provider {
  #options; #url;
  constructor(options){
    this.#options = options || {};
    this.#url = false;
  }
  set updateOptionsWith(option){
    this.#options = Object.assign(this.#options, option);
  }
  get options(){
    return this.#options
  }
  set _url(url){
    this.#url = url;
  }
  get _url(){
    return this.#url
  }
}

class Source extends IPFS_Provider {
  constructor(options){
    super(options)
  }
  set url(url){
    const insertIndex = url.indexOf('.');
    this._url = typeof url === 'boolean' ? false : cid => 
      url.slice(0, insertIndex) + cid.toString() + url.slice(insertIndex)
  }
  get url(){
    return this._url
  }
}

class Sink extends IPFS_Provider {
  constructor(options){
    super(options)
  }
  set url(url){
    this._url = typeof url === 'boolean' ? false : cid => 
      typeof cid === 'string' ? `${url}/pin/rm?arg=${cid}` : `${url}/block/put`;
  }
  get url(){
    return this._url
  }
}

// for caching instances of Data
class Datums extends SetOf {
  constructor(size){
    super((a, b) => CID.equals(a.cid, b.cid));
    this.size = size;
  }
}

// wraps a multiformats block in accessors, caching, and methods for writing and reading
// to and from ipfs with asymetric and shared key libsodium encryption
class Data {
  #block; #cid; #rawBytes; #ready; #size;
  constructor(data, codec=cbor){
    this.codec = codec;
    if(data instanceof Block.Block){
      this.#block = data;
      this.#cid = data.cid;
      this.#rawBytes = new Uint8Array(0);
      this.#ready = Promise.resolve(this);
      this.#size = data.byteLength;
    }
    else {
      this.value = data;
    }
    console.log(`this Data.source is `, Data.source);
    console.log(`this Data.sink is `, Data.sink);
  }

  // access away

  get block(){
    return this.#block
  }

  get cid(){ 
    return this.#cid
  }

  get links(){
    const links = {};
    for(const [name, cid] of this.#block.links())
      links[name] = cid;
    return links
  }

  get ready(){
    return this.#ready
  }

  get value(){
    return this.#block.value
  }

  set cid(theCid){
    return this.#cid = theCid
  }

  set value(obj){
    try{
      this.#ready = Block.encode({value: obj, codec: this.codec, hasher}).then(theThen.bind(this))
    } catch (e) {
      this.#ready = Block.encode({value: obj, codec: raw, hasher}).then(theThen.bind(this))
    }
    function theThen(block){
      this.#size = block.byteLength;
      this.#cid = block.cid;
      this.#block = block;
      return this
    };    
  }
  
  // you can set <cache.readFrom = false> for debugging.
  // When set to false, cache will continue functioning
  // but immitate a hit failure, forcing ipfs query from
  // Data.read()  
  static cache = new Datums(100);

  // 
  static source = new Source({headers: {"Accept": "application/vnd.ipld.raw"}});
  static sink = new Sink({method: 'POST'});

  // used when authenticating a block and requesting a cid from ipfs/block/put
  static codecForCID(cid){
    return [cbor, json, pb, raw].filter(codec => cid.code === codec.code).pop()
  }

  // left here to support legacy code
  // call read() instead now
  static fromCID(cid, keys=null){
    return this.read(cid, keys)
  }

  // encrypts with cipher selected by key properties
  static async lock(plainText, keys=null){  // returns a Uint8Array
    if(keys === null)
      return Promise.resolve(plainText)

    if(keys?.shared)
      // encrypts with libsodium crypto_secretbox_easy
      return await sodium.encrypt(plainText, keys.shared)

    // encrypts with libsodium crypto_box_easy
    return await sodium.encryptFor(plainText, keys.reader, keys.writer)
  }

  // decrypts with cipher selected by key properties
  static open(cipherText, keys=null){ // returns a Uint8Array
    if(keys === null)
      return Promise.resolve(cipherText)

    if(keys?.shared){
      // decrypts with libsodium crypto_secretbox_easy
      return sodium.decrypt(cipherText, keys.shared)
    }

    // decrypts with libsodium crypto_box_easy
    return sodium.decryptFrom(cipherText, keys.reader, keys.writer).then(plaintext => {
      return plaintext
    })
  }

  // returns an instance of calling class read from cid
  static async read(cid, keys=null, codec=cbor){
    cid = CID.asCID(cid) ? cid : CID.parse(cid);
    const cached = this.cache.fetch({cid: cid});
    if(cached){
      return Promise.resolve(cached)      
    }
    if(this.source.url){
      var rawBytes = await request(this.source.url(cid), this.source.options);
    }
    else
      var rawBytes = Object.values(JSON.parse(localStorage.getItem(cid.toString())));
    // rawBytes are either an ArrayBuffer or Array
    rawBytes = new Uint8Array(rawBytes);
    // block.create() checks bytes received against their address (cid)
    if(keys){
      var block = await Block.create({bytes: rawBytes, cid, codec: this.codecForCID(cid), hasher});
      const bytes = await this.open(block.bytes, keys);
      block = await Block.decode({bytes: bytes, codec, hasher})
    } else {
      var block = await Block.create({bytes: rawBytes, cid, codec: this.codecForCID(cid), hasher})
    }

    const instance = new this(block);
    instance.#rawBytes = rawBytes;
    instance.#size = rawBytes.byteLength;
    instance.#cid = cid;
    this.cache.add(instance);
    await instance.ready
    return instance
  }

  static rm(cid){
    cid = CID.asCID(cid) ? cid : CID.parse(cid);
    const cached = this.cache.fetch({cid: cid});
    if(cached)
      this.cache.remove({cid: cid});
    if(!this.sink.url){
      if(DEBUG) console.log(`removing ${cid.toString()} from localStorage`);
      return Promise.resolve(localStorage.removeItem(cid.toString()))
    }
    // calling sink.url() with string returns pin/add url
    return request(this.sink.url(cid.toString()), this.sink.options)
      .then(response => console.log(`unpinned ${cid.toString()}`))
      .catch(err => 
        // catches an error that throws even when the pin is removed
        console.error(`error unpinning ${cid.toString()}:`, err)
      )
  }

  async write(name='', keys=null, cache=false, deleteLast=true){
    await this.#ready;
console.log(`going to write this: `, this);
    return this.#block.bytes.length > BLOCK_SIZE ?
      this.writeChunked(name, keys, cache, deleteLast) :
      this.writeBlock(name, keys, cache, deleteLast)
  }

  async writeBlock(name, keys, cache, deleteLast){
    await this.#ready;

    if(keys){
      const cipherText = await Data.lock(this.#block.bytes, keys);
      const block = await Block.encode({value: cipherText, codec: raw, hasher});
      this.#rawBytes = block.bytes;
      this.#cid = block.cid;
    }

    const bytes = !keys && this.#cid.toString() === this.#block.cid.toString() ? this.#block.bytes : this.#rawBytes;

    this.#size = bytes.byteLength;

    if(cache)
      Data.cache.add(this);

    const lastAddress = Object.hasOwn(this.links, `${name}_last`) ? this.links[`${name}_last`].toString() : false;


    if(!Data.sink.url)
      try{
        localStorage.setItem(this.#cid.toString(), JSON.stringify(bytes));
        if(DEBUG) console.log(`added ${name}, ${this.#cid.toString()} to localStorage`);
        if(deleteLast && !!lastAddress && Object.hasOwn(localStorage, lastAddress)){
          localStorage.removeItem(lastAddress);
          if(DEBUG) console.log(`removed last address of ${this.name}, ${lastAddress}, from localStorage`);
        }
        return Promise.resolve(this)
      } catch (err) {
        console.error(`failed to save ${name} correctly: `, err);
        return Promise.reject(this)
      }
console.log(`going to call ${Data.sink.url(this.#cid)} with options `, Data.sink.options);
    return request(
      // calling sink.url() with a cid returns a block/put url
      `${Data.sink.url(this.#cid)}?cid-codec=${Data.codecForCID(this.#cid).name}&pin=true`,
      new mfdOpts([{
        data: bytes,
        type: "application/octet-stream",
        'name': name
      }], Data.sink.options))
      .then(async response => {
console.log(`block/put response is: `, response);
        const writeResponse = JSON.parse(response);
        if(DEBUG) console.log(`wrote ${name} at ${writeResponse.Key}`);
        if(!CID.equals(this.#cid, CID.parse(writeResponse.Key)))
          throw new Error(`block CID: ${this.#cid.toString()} does not match write CID: ${writeResponse.Key}`)
      })
      .then(response => this)
      .catch(error => console.error(`error persisting ${name}: `, error))
  }

  async writeChunked(name, keys, cache, deleteLast){
    // write raw leaf nodes
    let i = 0, j = BLOCK_SIZE, links = [];
    const Link = (cid, name, length) => `{"Hash":${cid},"Name":${name},"Tsize":${length}}`;
    while(j <  this.#block.bytes.length){
      const chunk = await new Data(this.#block.bytes.slice(i,j), raw).writeBlock();
      links.push(pb.createLink('', chunk.#block.bytes.length, chunk.cid));
      i += BLOCK_SIZE;
      j += BLOCK_SIZE;
    }
    const chunk = await new Data(this.#block.bytes.slice(i), raw).writeBlock();
    links.push(pb.createLink('', chunk.#block.bytes.length, chunk.cid));

    // make UnixFS wrapper for leaves
    const file = new UnixFS({type: 'file'});
    links.map(link => file.addBlockSize(BigInt(link.Tsize)));
    const pbNode = pb.createNode(file.marshal(), links);
    return await new Data(pbNode, pb).writeBlock(name)
  }
}

class Image extends Data {
  constructor(){
    super(...arguments, raw)
  }
}

export {Data, Image, request};