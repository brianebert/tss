
/*  The contents of this file were written by Brian Ebert, an American citizen residing in Guadalajara, Jalisco, Mexico.
 *  All rights reserved.
 *  2020/11/5
 */

import * as Block from 'multiformats/block'
import {CID} from 'multiformats/cid';
import * as cbor from '@ipld/dag-cbor';
import * as json from '@ipld/dag-json';
import * as pb from '@ipld/dag-pb';
import * as raw from 'multiformats/codecs/raw';
import { walk } from 'multiformats/traversal';
import { sha256 as hasher } from 'multiformats/hashes/sha2';

//import Hash from 'ipfs-only-hash';
import {SetOf} from './cache.js';
import {mfdOpts, request} from './http.js';
import * as sodium from './na.js';

const INFURA_IPFS = 'https://motia.com/api/v1/ipfs';
const IPFS_GATEWAY = 'https://motia.infura-ipfs.io/ipfs';


function codecForCID(cid){
  return [cbor, json, pb, raw].filter(codec => cid.code === codec.code).pop()
}

class Instances extends SetOf {
  constructor(size){
    super((a, b) => CID.equals(a.cid, b.cid));
    this.size = size;
  }
}

class Data {
  #block; #cid; #ready;
  constructor(data, codec=cbor){
    this.codec = codec;
    if(data instanceof Block.Block){
      this.#block = data;
      this.#cid = data.cid;
      this.#ready = Promise.resolve();
    }
    else {
      this.value = data;
    }
  }

  get block(){
    return this.#block
  }

  get cid(){ 
    return this.#cid
  }

  get data(){
    const value = Object.assign({}, this.#block.value);
    for(let key of Object.keys(this.links))
      delete value[key];
    return value
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

  set value(obj){
    try{
      this.#ready = Block.encode({value: obj, codec: this.codec, hasher}).then(theThen.bind(this))
    } catch (e) {
      this.#ready = Block.encode({value: obj, codec: raw, hasher}).then(theThen.bind(this))
    }
    function theThen(block){
      this.#cid = block.cid;
      this.#block = block;
    };    
  }
  
  static cache = new Instances(100);

  static fromCID(cid, keys=null){ // left here to support legacy code
    return this.read(cid, keys)
  }

  static async lock(plainText, keys=null){  // returns a Uint8Array
    if(keys === null)
      return Promise.resolve(plainText)

    if(keys?.shared)
      return await sodium.encrypt(plainText, keys.shared)

    return await sodium.encryptFor(plainText, keys.reader, keys.writer)
  }

  static open(cipherText, keys=null){ // returns a Uint8Array
    if(keys === null)
      return Promise.resolve(cipherText)

    if(keys?.shared){
      return sodium.decrypt(cipherText, keys.shared).then(plaintext => {
        return plaintext
      })
    }

    return sodium.decryptFrom(cipherText, keys.reader, keys.writer).then(plaintext => {
      return plaintext
    })
  }

  static async read(cid, keys=null, codec=cbor){
    cid = CID.asCID(cid) ? cid : CID.parse(cid);
    const cached = Data.cache.fetch({cid: cid});
    if(cached){
      //console.log(`read from cache: `, cached)
      return Promise.resolve(cached)
    }
    let bytes = await request(`${IPFS_GATEWAY}/${cid.toString()}`, {headers: {"Accept": "application/vnd.ipld.raw"}});
    bytes = new Uint8Array(bytes);
    if(keys){
      var block = await Block.create({bytes: bytes, cid, codec: codecForCID(cid), hasher});
      bytes = await Data.open(block.bytes, keys);
      block = await Block.decode({bytes: bytes, codec, hasher})
    } else {
      var block = await Block.create({bytes: bytes, cid, codec: codecForCID(cid), hasher})
    }
    const instance = new this(block);
    instance.cid = cid;
    Data.cache.add(instance);
    await instance.ready
    return instance
  }

  async write(name='', keys=null, cache=true){
    await this.#ready;
    let block = this.#block;
    if(keys){
      const cipherText = await Data.lock(block.bytes, keys);
      block = await Block.encode({value: cipherText, codec: raw, hasher});
    }
    this.#cid = block.cid;
    if(cache)
      Data.cache.add(this);
    // To write to IPFS /block/put you must supply below YOUR_IPFS http api root to request()
    // to write to YOUR_IPFS /block/put endpoint, remove the next line of code
    //return this
    // Remove the preceeding line to write to your IPFS /block/put endpoint
    // To write to IPFS /block/put you must supply below YOUR_IPFS http api root
    return request(
      `${INFURA_IPFS}/block/put?cid-codec=${codecForCID(block.cid).name}`,
      new mfdOpts([{
        data: block.bytes,
        type: "application/octet-stream",
        'name': name
      }])
    )
    .catch(error => console.error(`http.request produced error: `, error))
    .then(response => {
      const writeResponse = JSON.parse(response);
      if(!CID.equals(block.cid, CID.parse(writeResponse.Key)))
        throw new Error(`block CID: ${block.cid.toString()} does not match write CID: ${writeResponse.Key}`)
      return this
    })
  }
}

export {Data, request};