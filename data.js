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
  #block; #cid; #encryptedBytes; #ephemeral; #ready; #size;
  constructor(data, codec=cbor){
    this.codec = codec;
    if(data instanceof Block.Block){
      this.#block = data;
      this.#cid = data.cid;
      this.#encryptedBytes = new Uint8Array(0)
      this.#ephemeral = true;
      this.#size = data.byteLength;
      this.#ready = Promise.resolve(this);
    }
    else {
      this.value = data;
    }
  }

  // access away

//  get block(){
  //  return this.#block
  //}

  get cid(){ 
    return this.#cid
  }

//  get data(){
  //  const value = Object.assign({}, this.#block.value);
    //for(let key of Object.keys(this.links))
    //  delete value[key];
  //  return value
//  }

  get ephemeral(){
    return this.#ephemeral
  }

  get links(){
    const links = {};
    for(const [name, cid] of this.#block.links())
      links[name] = cid.toString();
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

  set ephemeral(state){
    return this.#ephemeral = state
  }

  set value(obj){
    try{
      this.#ready = Block.encode({value: obj, codec: this.codec, hasher}).then(theThen.bind(this))
    } catch (e) {
      this.#ready = Block.encode({value: obj, codec: raw, hasher}).then(theThen.bind(this))
    }
    function theThen(block){
      this.#size = block.byteLength;
      this.#ephemeral = true;
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
      console.log(`read ${cached.cid.toString()} from cache`);
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
    if(keys)
      instance.#encryptedBytes = rawBytes;
    instance.#size = rawBytes.byteLength;
    instance.#ephemeral = false;
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
      console.log(`removing ${cid.toString()} from localStorage`);
      return Promise.resolve(localStorage.removeItem(cid.toString()))
    }
    // calling sink.url() with string returns pin/add url
    return request(
        this.sink.url(cid.toString()).replace('add', 'ls'), {method: 'POST'}
      )
      .then(response => JSON.parse(response))
      .then(pin => {
        console.log(`rm(${cid.toString()}) found pin: `, pin);
        return request(this.sink.url(cid.toString()).replace('add', 'rm'), {method: 'POST'})
      })
      .then(response => JSON.parse(response))
      .then(unPin => console.log(`unpinned: `, unPin))
      .catch(err => 
        console.error(`error unpinning ${cid.toString()}:`, err)
      )
  }

  async persist(name=''){
    const bytes = this.#encryptedBytes.byteLength === 0 ? this.#block.bytes : this.#encryptedBytes;
    this.#size = bytes.byteLength;
    this.#ephemeral = false;
    let lastAddress = false;
    if(Object.hasOwn(this.links, `${this.name}_last`))
      lastAddress = this.links[`${this.name}_last`].toString();
    if(!Data.sink.url)
      try{
        localStorage.setItem(this.#cid.toString(), JSON.stringify(bytes));
        console.log(`added ${this.name}, ${this.#cid.toString()} to localStorage`);
        if(Object.hasOwn(localStorage, lastAddress)){
          localStorage.removeItem(lastAddress);
          console.log(`removed last address of ${this.name}, ${lastAddress}, from localStorage`);
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
console.log(`wrote ${this.name} at ${writeResponse.Key}`);
        if(!CID.equals(this.#cid, CID.parse(writeResponse.Key)))
          throw new Error(`block CID: ${this.#cid.toString()} does not match write CID: ${writeResponse.Key}`)
        const pinReqs = [request(Data.sink.url(writeResponse.Key), {method: 'POST'})];
        if(lastAddress) await request(Data.sink.url(lastAddress).replace('add', 'ls'), {method: 'POST'})
          .then(response => {
            pinReqs.push(request(Data.sink.url(lastAddress).replace('add', 'rm'), {method: 'POST'}));
          })
          .catch(err => {
            console.log(`${lastAddress} was not pinned. `, err);
          })
        console.log(`pinning with: `, pinReqs);
        return Promise.all(pinReqs)
      })
      .then(([addResponse, rmResponse]) => {
        const added = JSON.parse(addResponse);
        if(!added.Pins.includes(this.#cid.toString()))
          throw new Error(`was not able to pin ${this.#cid.toString()} pinResponse: `, added)
      })
      .catch(error => console.error(`error persisting ${this.name}: `, error))
  }

  // write ciphertext if keys are provided
  // calls can be edited to omit name parameter (because I split off persist())
  async write(name='', keys=null, cache=true){
    await this.#ready;
    let block = this.#block;
    if(keys){
      const cipherText = await Data.lock(block.bytes, keys);
      block = await Block.encode({value: cipherText, codec: raw, hasher});
      this.#encryptedBytes = block.bytes;
    }
    this.#cid = block.cid;
    if(cache)
      Data.cache.add(this);

    this.#ephemeral = true;
    return this
  }
}

export {Data, request};