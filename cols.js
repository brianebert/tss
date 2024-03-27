
/*  The contents of this file were written by Brian Ebert, an American citizen residing in Guadalajara, Jalisco, Mexico.
 *  All rights reserved.
 *  2020/11/5
 */

import { Data, request } from './data.js';
import { CID } from 'multiformats/cid';

// adds properties refering to a parent nodes and a timestamp
// and methods for inserting, deleting, and updating nodes
// while maintaining their hash links (in bubbleBubble())
class COL_Node extends Data {
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

  // percolate hash changes through parents generation by generation
  static fizz(nodes, keys){
    if(nodes.length === 1 && nodes[0].parents.length === 0)
      return Promise.resolve(nodes[0])
    const deDuped = new Set();
    // first collect all the parents of this generation
    for(let i=0; i < nodes.length; i++)
      for(let j=0; j < nodes[i].parents.length; j++)
        deDuped.add(nodes[i].parents[j]);
    // make copies of their block values, along with id and name
    const parentValues = Array.from(deDuped)
                              .map(parent => new Object({
                                id: parent.cid.toString(),
                                name: parent.name, 
                                value: Object.assign({}, parent.value)
                              })
                            );
    // update copies' link values
    for(let i=0; i < nodes.length; i++)
      for(let j=0; j < parentValues.length; j++){
        parentValues[j].value[`${parentValues[j].name}_last`] = CID.parse(parentValues[j].id); 
        // are you my parent? then update my link.
        if(Object.keys(parentValues[j].value).includes(nodes[i].name))
          if(nodes[i].cid === undefined)
            delete parentValues[j].value[nodes[i].name];
          else
            parentValues[j].value[nodes[i].name] = nodes[i].cid;
        parentValues[j].value['modified_at'] = new Date().toUTCString();
      }
    deDuped.forEach(parent => {
      // calls Data instance's value(v) setter that hashes a new block from v
      parent.value = parentValues.filter(value => value.id === parent.cid.toString()).pop().value;
    });
    // blocks aren't encrypted until written
    return Promise.all(Array.from(deDuped).map(parent => parent.write(parent.name, keys)))
      // now there is a cid for the encrypted block
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
    return COL_Node.fizz([this], keys)
  }

  // make node a child of self
  async insert(nodes, keys=null){
    const readies = nodes.map(node => node.ready);
    await Promise.all([this.ready, ...readies]);
    let value = Object.assign({}, this.value);
    for(const node of nodes){
      value[node.name] = node.cid;
      node.parents.push(this);
    }
    this.value = value;
    return this.write(this?.name ? this.name : '', keys)
               .then(() => COL_Node.fizz([this], keys)) 
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
               .then(writeResult => COL_Node.fizz([this], keys))
  }
}


export {COL_Node, request}