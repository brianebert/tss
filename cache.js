export class SetOf {
  #equals;
  #members;
  constructor(equals){
    this.#equals = equals;
    this.#members = [];
  }

  add(proposed){
    if(this?.size && this.size === this.#members.length)
      this.#members.pop();
    const index = this.#members.findIndex(member => this.#equals(member, proposed));
    if(index !== -1)
      this.#members.splice(index, 1);
    return this.#members.unshift(proposed)
  }

  fetch(id){
    const index = this.#members.findIndex(member => this.#equals(id, member));
    //console.log(`SetOf fetch found index:${index} searching cache for: `, id);
    if(index === -1)
      return null
    return this.#members[index]    
  }

  filter(fn){
    return this.#members.filter(member => fn(member))
  }

  map(fn){
    return this.#members.map(member => fn(member))
  }

  remove(proposed){
    const index = this.#members.findIndex(member => this.#equals(member, proposed));
    if(index === -1)
      throw new Error(`setOf.remove(proposed) cannot find index of proposed: `, proposed)
    return this.#members.splice(index, 1)
  }

  replace(proposed){
    const index = this.#members.findIndex(member => this.#equals(member, proposed));
    if(index === -1)
      throw new Error(`setOf.remove(proposed) cannot find index of proposed: `, proposed)
    this.#members.splice(index, 1);
    return this.#members.unshift(proposed)
  }
}