import {SigningAccount} from './signing.js';
import {COL_Node} from './cols.js';

// combines SigningAccount keys with COL_Node
class Encrypted_Node extends COL_Node {
  #dataRootLabel; #signingAccount;
  constructor(value, signingAccount, dataRootLabel=null){
console.log(`creating Encrypted_Node from value `, value);
console.log(`and SigningAccount `, signingAccount);
    if(!signingAccount instanceof SigningAccount)
      throw new Error(`called Encrypted_Node constructor with signingAccount = `, signingAccount)
    super(value);
    this.#signingAccount = signingAccount;
    if(dataRootLabel)
      this.#dataRootLabel = dataRootLabel;
console.log(`created Encrypted_Node: `, this);
  }

  get signingAccount(){
    return this.#signingAccount
  }

  static async fromCID(account, cid, keys=null){
    if(!account instanceof SigningAccount)
      throw new Error(`Must call Encrypted_Node.fromCID with a SigningAccount`)
    return this.read(cid, keys).then(async instance => {
        instance.#signingAccount = account;
        await instance.ready;
        return instance
      })
  }

  static async fromSigningAccount(account, dataRootLabel, keys=null){
    const root = await SigningAccount.dataEntry(account, dataRootLabel);
    console.log(`looked up data root: ${root.toString()}`)
    if(root.length === 0){
      var node = new this({colName: dataRootLabel}, account, dataRootLabel);
      await node.ready;
    }
    else {
      var node = await this.fromCID(account, root.toString(), keys);
      node.#dataRootLabel = dataRootLabel;
    }
    return node
  }

  static async persist(root, keys=null){
    const signingAccount = root.signingAccount;
    const name = root.#dataRootLabel;
    const cid = rood.cid;
    const graphNodes = []; // (hopefully) will use later cleaning cache and local storage
    const persistAll = this.blockParameters.persistAll;
    async function writeNode(node){
      graphNodes.push(node.cid.toString());
      if(persistAll || node.ephemeral)
        await node.persist(node.name);
    }
    if(this.blockParameters.traverse.value)
      await this.traverse(cid, writeNode, keys);
    else
      await this.read(cid, keys).then(writeNode);
    // clean cache and localStorage here
    for(const member of this.cache.filter(member => !graphNodes.includes(member.cid.toString())))
      console.log(`planning to delete ${member.cid.toString()} from cache`); 
    for(const key of Object.keys(localStorage).filter(key => !graphNodes.includes(key)))
      //localStorage.removeItem(key);
    console.log(`setting data entry for ${label}: `, cid.toString());
    return signingAccount.setDataEntry(name, cid.toString());
  }

  static SigningAccount = SigningAccount;

  // linking plaintext depends upon depth first COL_Node.traverse()
  /*static async publishPlaintext(root, keys, docName=null){
    if(!keys){
      if(window?.alert)
        window.alert(`publishPlaintext() was not provided keys. is document plaintext already?`);
      console.log(`publishPlaintext() was not provided keys. is document plaintext already?`);
      return
    }
    const context = this;
    const ptLinks = {}; // .cid of encrypted graph keys plaintext node.cid.toString()
    async function publishBlock(node){
      const ptValue = Object.assign({}, node.value);
      for(const link of Object.keys(node.links))
        if(!link.endsWith('_last'))
          ptValue[link] = ptLinks[node.links[link]];
      const ptNode = await new context(ptValue, node.signingAccount, node.name).write(node.name, null);
      ptLinks[node.cid.toString()] = ptNode.cid;
    }
    const ptRoot = await this.traverse(root.cid, publishBlock, keys);
    console.log(`have published plaintext document at `, ptLinks[ptRoot.cid.toString()])
    await this.persist(root.signingAccount, docName, ptLinks[ptRoot.cid.toString()], keys);
    console.log(`${root.signingAccount.account.id} has set ${docName} to ${ptLinks[ptRoot.cid.toString()].toString()}`);
    // Should purge cache of plaintext blocks here
  }*/
}

export {Encrypted_Node};