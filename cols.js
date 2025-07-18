
/*  The contents of this file were written by Brian Ebert, an American citizen residing in Guadalajara, Jalisco, Mexico.
 *  All rights reserved.
 *  2020/11/5
 */

import {ContentPointer} from './content_ptr.js';
import { Data, request } from './data.js';
import { CID } from 'multiformats/cid';

// adds properties refering to a parent nodes and a timestamp
// and methods for inserting, deleting, and updating nodes
// while maintaining their hash links (in bubbleBubble())
class COL_Node extends Data {
  #parents; #contentPointer;
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

  static async fromContentPointer(ptrId, index, keys=null){
    const contentPointer = new ContentPointer(ptrId);
    const [cid, currentIndex] = await Promise.all([
      contentPointer.address, contentPointer.index
    ]);
    const data = await this.read(cid, keys);
    const node = new COL_Node(data.block);
    node.#contentPointer = contentPointer;
    return node;
  }

  // percolate hash changes through parents generation by generation
  static async fizz(nodes, keys, sponsor=null, contentPointers=[]){
    if(nodes.length === 1 && nodes[0].parents.length === 0){
      if(sponsor){
        console.log(`now write ${contentPointers.length} content pointers`);
        for(const [ptr, cid] of contentPointers)
          console.log(`\t${ptr.id}:${await ptr.index} -> ${cid}`);
        const result = await ContentPointer.update(sponsor, contentPointers);
        console.log(`update result is: `, result);
      }
      return Promise.resolve(nodes[0])
    }
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
console.log(`have reduced parents to: `, parentValues);
    // update copies' link values
    for(let i=0; i < nodes.length; i++){
console.log(`fizzing node `, nodes[i].value)
      for(let j=0; j < parentValues.length; j++){
console.log(`${nodes[i].name} has parent ${parentValues[j].name} with value: `, parentValues[j].value);
        parentValues[j].value[`${parentValues[j].name}_last`] = CID.parse(parentValues[j].id); 
        // are you my parent? then update my link.
        if(Object.keys(parentValues[j].value).includes(nodes[i].name))
          if(nodes[i].cid === undefined || nodes[i].#contentPointer === undefined)
            delete parentValues[j].value[nodes[i].name];
          else {
            //const id = nodes[i].#contentPointer.id;
            const index = (parseInt(await nodes[i].#contentPointer.index) + 1).toString();
//console.log(`\twriting${parentValues[j].name} link ${nodes[i].name} ${id}:${index}`);
            parentValues[j].value[nodes[i].name] = `${nodes[i].#contentPointer.id}:${index}`;
          }
        parentValues[j].value['last_modified'] = new Date().toUTCString();
      }
    }
    deDuped.forEach(parent => {
console.log(`checking ${parent.name}: `, parent.value);
      // calls Data instance's value(v) setter that hashes a new block from v
      parent.value = parentValues.filter(value => value.id === parent.cid.toString()).pop().value;
console.log(`now ${parent.name} is: `, parent.value);
    });
    // blocks aren't encrypted until written
    return Promise.all(Array.from(deDuped).map(parent => parent.write(parent.name, keys)))
      .then(fizzed => {
        fizzed.map(node => 
          contentPointers.push([node.#contentPointer, node.cid])
        );
        return fizzed
      })
      // now there is a cid for the encrypted block
      .then(fizzed => this.fizz(fizzed, keys, sponsor, contentPointers))
  }

  // traverse blocks in depth first order, calling fn(instance, depth)
  // on each once and adding parent link to each subgraph traversed
  /*static async traverse(cid, fn=()=>{}, keys=null){
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
  }*/

    async traverse(fn=()=>{}, keys=null){
      const haveTraversed = new Set();
      async function recurse(cptr, fn, keys, depth=0){
        const [ptrId, index] = cptr.split(':');
        const contentPointer = new ContentPointer(ptrId);
        const [cid, currentIndex] = await Promise.all([
          contentPointer.address, contentPointer.index
        ]);
        console.log(`have read ${cid}:${currentIndex} for ${ptrId}:${index}`);
        return await COL_Node.fromContentPointer(ptrId, index, keys).then(async instance => {
          if(!haveTraversed.has(cptr)){
            haveTraversed.add(cptr);
            for(const link of Object.keys(instance.links))
              if(!link.endsWith('_last')){       
                const subGraph = await recurse(instance.links[link], fn, keys, depth + 1);
console.log(`subGraph ${subGraph.name} ${subGraph.cid.toString()} has value: `, subGraph.value);
                instance.value[link] = subGraph.#contentPointer.id + ':' + (await subGraph.#contentPointer.index);
                if(!subGraph.parents.map(parent => parent.cid.toString()).includes(instance.cid.toString()))
                  subGraph.parents.push(instance);
              }
            // fn must always return a promise!!
            await fn(instance, depth);
          }
          return instance
        })
      }
      const cptr = this.#contentPointer.id + ':' + (await this.#contentPointer.index);
      return recurse(cptr, fn, keys)
    }



/* The following functions alter leaf nodes. All terminate with a call 
 * to COL_Node.fizz(), which percolates hash changes through parents
 * generation by generation.
 */

  // remove self from graph
  async delete(keys, sponsor=null){
    await this.ready;
    console.log(`deleting ${this.name}`)
    Data.rm(this.cid);
    this.cid = undefined;
    return COL_Node.fizz([this], keys, sponsor, [[this.#contentPointer]])
  }

  // make node a child of self
  async insert(nodes, sponsor, keys){
    const readies = nodes.map(node => node.ready);
    //const pointerAccount = new SponsoredAccount(sponsor, keys);
    await Promise.all([this.ready, ...readies]);
    let value = Object.assign({}, this.value);
    //
    for(const node of nodes){
      value[node.name] = `${node.#contentPointer.id}:${await node.#contentPointer.index}`;
      node.parents.push(this);
    }
    this.value = value;
    return this.write(this?.name ? this.name : '', keys)
               .then(async () => {
                this.#contentPointer = new ContentPointer(null, this.cid.toString(), sponsor);
                await this.#contentPointer.ready;
    console.log(`now fizzing ${this.name} with ${this.#contentPointer.id}`);
                return COL_Node.fizz([this], keys, sponsor)
               })
  }

  // change value of self
  async update(updates, sponsor=null, keys=null){
    console.log(`updating ${this.name} ${keys?'ciphertext':'plaintext'} with: `, updates);
    const value = Object.assign({}, this.value);
    // first update existing values
    for(let key of Object.keys(value)){
      if(Object.hasOwn(updates, key))
        value[key] = updates[key];
      if(!value[key])
        delete value[key];
      delete updates.key;
    }
    // then add keys that appear for the first time on updates
    for(let key of Object.keys(updates))
      value[key] = updates[key];
    value['updated_at'] = new Date().toUTCString();
    value[`${this.name}_last`] = this.cid;
    this.value = value;
    return this.write(this.name, keys)
               .then(() => COL_Node.fizz(
                  [this], keys, sponsor, [[this.#contentPointer, this.cid]]
                ))
  }
}


export {COL_Node, request}