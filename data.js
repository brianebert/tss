import * as Block from 'multiformats/block'
import {CID} from 'multiformats/cid';
import * as cbor from '@ipld/dag-cbor';
import * as json from '@ipld/dag-json';
import * as pb from '@ipld/dag-pb';
import * as raw from 'multiformats/codecs/raw';
import { sha256 as hasher } from 'multiformats/hashes/sha2';

//import Hash from 'ipfs-only-hash';
import {SetOf} from './cache.js';
import {mfdOpts, request} from './http.js';
import * as sodium from './na.js';

const DEBUG = true;

class IPFS_Provider {
  #url;
  constructor(){
    this.#url = false;
  }
  set url(url){
    this.#url = url;
  }
  get url(){
    return this.#url
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
  static sink = new IPFS_Provider();
  static source = new IPFS_Provider();

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

    if(this.source.url)
      var rawBytes = await request(this.source.url(cid), {headers: {"Accept": "application/vnd.ipld.raw"}});
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
    return request(
        this.sink.url(cid.toString()).replace('add', 'ls'), {method: 'POST'}
      )
      .then(response => request(this.sink.url(cid.toString()).replace('add', 'rm'), {method: 'POST'}))
      .catch(err => 
        console.error(`error unpinning ${cid.toString()}:`, err)
      )
  }

  async write(name='', keys=null, cache=true, deleteLast=true){
    await this.#ready;

    if(keys){
      const cipherText = await Data.lock(this.#block.bytes, keys);
      const block = await Block.encode({value: cipherText, codec: raw, hasher});
      this.#rawBytes = block.bytes;
      this.#cid = block.cid;
    }

    const bytes = !keys && this.#cid.toString() === this.#block.cid.toString() ? this.#block.bytes : this.#rawBytes

    this.#size = bytes.byteLength;

    if(cache)
      Data.cache.add(this);

    const lastAddress = Object.hasOwn(this.links, `${this.name}_last`) ? this.links[`${this.name}_last`].toString() : false;


    if(!Data.sink.url)
      try{
        localStorage.setItem(this.#cid.toString(), JSON.stringify(bytes));
        if(DEBUG) console.log(`added ${this.name}, ${this.#cid.toString()} to localStorage`);
        if(deleteLast && !!lastAddress && Object.hasOwn(localStorage, lastAddress)){
          localStorage.removeItem(lastAddress);
          if(DEBUG) console.log(`removed last address of ${this.name}, ${lastAddress}, from localStorage`);
        }
        return Promise.resolve(this)
      } catch (err) {
        console.error(`failed to save ${this.name} correctly: `, err);
        return Promise.reject(this)
      }
    return request(
      // calling sink.url() with a cid returns a block/put url
        Data.sink.url(this.#cid),
        new mfdOpts([{
          data: bytes,
          type: "application/octet-stream",
          'name': name
        }])
      )
      .then(async response => {
        const writeResponse = JSON.parse(response);
        if(DEBUG) console.log(`wrote ${this.name} at ${writeResponse.Key}`);
        if(!CID.equals(this.#cid, CID.parse(writeResponse.Key)))
          throw new Error(`block CID: ${this.#cid.toString()} does not match write CID: ${writeResponse.Key}`)
        try {
          const pinLsResponse = JSON.parse(await request(Data.sink.url(lastAddress).replace('add', 'ls'), {method: 'POST'}));
          if(Object.hasOwn(pinLsResponse, 'Type') && pinLsResponse.Type === 'error')
            throw new Error(`No pin found for ${lastAddress}`)
        } catch {
          return request(Data.sink.url(writeResponse.Key), {method: 'POST'}) 
        }
        return request(`${Data.sink.url(lastAddress).replace('add', 'update')}&arg=${writeResponse.Key}`, {method: 'POST'})
      })
      .then(response => this)
      .catch(error => console.error(`error persisting ${this.name}: `, error))
  }
}

export {Data, request};