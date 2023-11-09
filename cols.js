
/*  The contents of this file were written by Brian Ebert, an American citizen residing in Guadalajara, Jalisco, Mexico.
 *  All rights reserved.
 *  2020/11/5
 */

import { Data, request } from './data.js';
import { CID } from 'multiformats/cid';

// adds properties refering to a parent nodes and a timestamp
// and methods for inserting, deleting, and updating nodes
// while maintaining their hash links (in bubbleBubble())
class IPFS_COL_Node extends Data {
  #parents;
  constructor(data){
    if(!Object.hasOwn(data, 'created_at'))
      data['created_at'] = new Date().toUTCString();
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
      value['modified_at'] = new Date().toUTCString();
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

  // traverse blocks in depth first order, calling fn(instance, depth) on each once
  static async traverse(cid, fn=()=>{}, keys=null){
    const context = this;
    const haveTraversed = new Set();
    async function recurse(cid, fn, keys, depth=0){
      return await context.read(cid, keys).then(async instance => {
        if(!haveTraversed.has(cid.toString())){
          haveTraversed.add(cid.toString());
          for(const link of Object.keys(instance.links))
            if(!link.endsWith('_last')){
              const subGraph = await recurse(instance.links[link], fn, keys, ++depth);
              instance.value[link] = subGraph.cid;
            }
          fn(instance, depth);
        }
        return instance
      })
    }
    return recurse(cid, fn, keys)
  }

  // remove self from graph
  async delete(keys){
    await this.ready;
    console.log(`deleting ${this.name}`)
    Data.cache.remove(this);
    this.cid = undefined;
    return IPFS_COL_Node.bubbleBubble(this, keys)
  }

  // make node a child of self
  async insert(node, linkName, keys=null){
    await Promise.all([this.ready, node.ready]);
    //console.log(`linking ${linkName} to ${this.name}`);
    let value = Object.assign({}, this.value);
    value[linkName] = node.cid;
    this.value = value;
    node.parents.push(this);
    value = Object.assign({}, node.value);
    value['inserted_at'] = new Date().toUTCString();
    node.value = value;
    return node.write(node?.name?node.name:'', keys)
               .then(writeResult => IPFS_COL_Node.bubbleBubble(node, keys)) 
  }

  // change value of self
  async update(updates, keys=null){
    console.log(`updating ${this.name} ${keys?'ciphertext':'plaintext'} with: `, updates);
    const value = Object.assign({}, this.value);
    for(let key of Object.keys(value)){
      if(Object.hasOwn(updates, key))
        value[key] = updates[key];
      else {
        //Data.cache.remove(value[key]);  Need Data.read() to cache before calling this.
        delete value[key];
      }
      delete updates.key;
    }
    for(let key of Object.keys(updates))
      value[key] = updates[key];
    value['updated_at'] = new Date().toUTCString();
    this.value = value;
    return this.write(this.name, keys)
               .then(writeResult => IPFS_COL_Node.bubbleBubble(this, keys))
  }
}


export {IPFS_COL_Node as COL_Node, request}