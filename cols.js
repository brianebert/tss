
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

  static bubble(node, keys){
    return Promise.all(node.parents.map(parent => {
      const value = Object.assign({}, parent.value);
      if(node.name in parent.links && !node?.cid)
        delete value[node.name];
      else
        value[node.name] = node.cid;
      value['modified_at'] = new Date().toUTCString();
      value[`${parent.name}_last`] = parent.cid;
      parent.value = value;
      return parent.write(parent.name, keys);
    }))
    .then(parents => {
      const deDuped = Array.from(new Set(parents));
      if(deDuped.length > 1 || deDuped[0].parents.length > 0)
        return deDuped.map(parent => this.bubble(parent, keys))
      return deDuped.pop()
    })
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

  static fizz(nodes, keys){
    if(nodes.length === 1 && nodes[0].parents.length === 0)
      return Promise.resolve(nodes[0])
    const deDuped = new Set();
    // first collect all the parents of this generation
    for(let i=0; i < nodes.length; i++)
      for(let j=0; j < nodes[i].parents.length; j++)
        deDuped.add(nodes[i].parents[j]);
    const parentValues = Array.from(deDuped)
                              .map(parent => new Object({
                                id: parent.cid.toString(),
                                name: parent.name, 
                                value: Object.assign({}, parent.value)
                              })
                            );
//parentValues.map(parent => console.log(`${parent.id}´s values are: `, parent.value));
    // and update their link values
    for(let i=0; i < nodes.length; i++)
      for(let j=0; j < parentValues.length; j++){
        if(Object.keys(parentValues[j].value).includes(nodes[i].name && !nodes[i].cid))
          delete parentValues[j].value[nodes[i].name];
        else
          parentValues[j].value[nodes[i].name] = nodes[i].cid;
        parentValues[j].value['modified_at'] = new Date().toUTCString();
        parentValues[j].value[`${parentValues[j].name}_last`] = CID.parse(parentValues[j].id);
      }
    deDuped.forEach(parent => {
      parent.value = parentValues.filter(value => value.id === parent.cid.toString()).pop().value;
    });
    // they aren't encrypted until written
    return Promise.all(Array.from(deDuped).map(parent => parent.write(parent.name, keys)))
      .then(fizzed => this.fizz(fizzed, keys))
  }

  // traverse blocks in depth first order, calling fn(instance, depth)
  // on each once and adding parent link to each subgraph traversed
  static async traverse(cid, fn=()=>{}, keys=null){
    const context = this;
    const haveTraversed = new Set();
    async function recurse(cid, fn, keys, depth=0){
      return await context.read(cid, keys).then(async instance => {
        if(!haveTraversed.has(cid.toString())){
          haveTraversed.add(cid.toString());
          for(const link of Object.keys(instance.links))
            if(!link.endsWith('_last')){       
              const subGraph = await recurse(instance.links[link], fn, keys, depth + 1);
              instance.value[link] = subGraph.cid;
              if(!subGraph.parents.map(parent => parent.cid.toString()).includes(instance.cid.toString()))
                subGraph.parents.push(instance);
            }
          // fn must always return a promise!!
          await fn(instance, depth);
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
    Data.rm(this.cid);
    this.cid = undefined;
    return IPFS_COL_Node.fizz([this], keys)
  }

  // make node a child of self
  async insert(node, linkName, keys=null){
    await Promise.all([this.ready, node.ready]);
    //console.log(`linking ${linkName} to ${this.name}`);
    let value = Object.assign({}, this.value);
    value[linkName] = node.cid;
    this.value = value;
    node.parents.push(this);
    return this.write(node?.name ? node.name : '', keys)
               .then(() => {
//console.log(`insert() is going to fizz() ${this.name}: `);
//console.log(`and ${this.name}'s parents are: `, this?.parents);
//console.log(`The type of this.insert() is ${typeof this?.insert}`);
                return IPFS_COL_Node.fizz([this], keys)
               }) 
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
    value[`${this.name}_last`] = this.cid;
    this.value = value;
    return this.write(this.name, keys)
               .then(writeResult => IPFS_COL_Node.fizz([this], keys))
  }
}


export {IPFS_COL_Node as COL_Node, request}