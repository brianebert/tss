
/*  The contents of this file were written by Brian Ebert, an American citizen residing in Guadalajara, Jalisco, Mexico.
 *  All rights reserved.
 *  2020/11/5
 */

import { CID } from 'multiformats/cid';
import { Data, request } from './data.js';

// CIDv1, 0 bytes, raw codec, sha256
const ZERO_BLOCK_CID = CID.parse('bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku');


class IPFS_COL_Node extends Data {
  #parents;
  constructor(data){
    super(data);
    this.#parents = [];
  }

  get parents(){
    return this.#parents
  }

  get name(){
    return this?.value.colName
  }

  /* toil and trouble
   * args: a new IPFS_COL_Node
   * returns: top level IPFS_COL_Node
   */
  static async bubbleBubble(node, keys){
    async function bubble(node, parent, keys){
    /* if node.name not in parent's links, put it there
     * if node.name in parent's links and the hashes are equal, delete node and references to it
     * if node.name in parent's links with a different hash, update the hash
     *
     * then update my_previous_value link on parent and
     * if node.parent.parent exists, recurse upward
     *
     */
      const value = Object.assign({}, parent.value);
      if(node.name in parent.links && !node?.cid)
        delete value[node.name];
      else
        value[node.name] = node.cid;
      value[`${parent.name}_last`] = parent.cid;

      parent.value = value;
      await parent.write(parent.name, keys);

      return this.bubbleBubble(parent, keys)
    }

    return await node.parents.reduce((curr, next) => 
      curr.then(() => 
        bubble.call(this, node, next, keys)
      ), 
      Promise.resolve(node)
    )
  }

  static fromCID(cid, keys=null){ // left here to support legacy code
    return this.read(cid, keys).then(instance => {
        instance.#parents = [];
        return instance
      })
  }

  static async traverse(cid, fn, keys=null){
    console.log(`called .traverse with typeof fn = ${typeof fn}`);
    return await this.read(cid, keys).then(async instance => {
      console.log(`have read instance: `, instance.value);
      return fn(instance, keys, fn)
    })
  }

  async delete(keys){
    await this.ready;
    console.log(`deleting ${this.name}`)
    Data.cache.remove(this);
    this.cid = undefined;
    return IPFS_COL_Node.bubbleBubble(this, keys)
  }

  async insert(node, linkName, keys=null){
    await Promise.all([this.ready, node.ready]);
    //console.log(`linking ${linkName} to ${this.name}`);
    this.value[linkName] = node.cid;
    node.parents.push(this);
    return node.write(node?.name?node.name:'', keys)
               .then(writeResult => IPFS_COL_Node.bubbleBubble(node, keys)) 
  }

  async update(updates, keys=null){
    console.log(`updating ${this.name} ${keys?'ciphertext':'plaintext'} with: `, updates);
    const value = Object.assign({}, this.value);
    for(let key of Object.keys(value)){
      console.log(`processing key ${key} of updates: `, updates);
      if(updates[key])
        value[key] = updates[key];
      else {
        //Data.cache.remove(value[key]);  Need Data.read() to cache before calling this.
        delete value[key];
      }
      delete updates.key;
    }
    for(let key of Object.keys(updates))
      value[key] = updates[key];
    console.log(`updating this.value to: `, value);
    this.value = value;

    return this.write(this.name, keys)
               .then(writeResult => IPFS_COL_Node.bubbleBubble(this, keys))
  }
}


export {IPFS_COL_Node as COL_Node, request}