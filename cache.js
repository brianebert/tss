// implements a set of objects 
export class SetOf {
  #equals;
  #members;
  #readFrom;
  constructor(equals){
    this.#equals = equals;
    this.#members = [];
    this.#readFrom = true;
  }

  // setting #readFrom false leaves cache operating, but forces other 
  // read circuits to run by faking a cache hit (fetch(id)) failure
  set readFrom(state){
    this.#readFrom = state
  }

  // add object to cache from its front
  add(proposed){
    if(this.size === this.#members.length)
      this.#members.pop();
    const index = this.#members.findIndex(member => this.#equals(member, proposed));
    if(index !== -1)
      this.#members.splice(index, 1);
    return this.#members.unshift(proposed)
  }

  // return cqche hits
  fetch(id){
    const index = this.#members.findIndex(member => this.#equals(id, member));
    if(index === -1)
      return null
    if(this.#readFrom)
      return this.#members[index] // CHANGE THIS TO .at() and implement in Members above
    return null  
  }

  remove(proposed){
    const index = this.#members.findIndex(member => this.#equals(member, proposed));
    if(index === -1)
      throw new Error(`setOf.remove(proposed) cannot find index of proposed: `, proposed)
    return this.#members.splice(index, 1)
  }

  // applies Array.filter() to members
  filter(fn){
    return this.#members.filter(member => fn(member))
  }

  // applies Array.map() to members
  map(fn){
    return this.#members.map(member => fn(member))
  }
}