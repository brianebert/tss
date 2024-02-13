import {SigningAccount} from './signing.js';
import {COL_Node} from './cols.js';

// combines SigningAccount keys with COL_Node
class Encrypted_Node extends COL_Node {
  #dataRootLabel; #signingAccount;
  constructor(value, signingAccount, dataRootLabel=''){
    if(!signingAccount instanceof SigningAccount)
      throw new Error(`called Encrypted_Node constructor with signingAccount = `, signingAccount)
    super(value);
    this.#signingAccount = signingAccount;
    this.#dataRootLabel = dataRootLabel;
  }

  get signingAccount(){
    return this.#signingAccount
  }

  set dataRootLabel(label){ // setting dataRootLabel will write a node's hash to Stellar
    return this.#dataRootLabel = typeof label === 'string' ? label : ''
  }

  static bP;
  static get blockParameters(){
    return this.bP
  }
  static set blockParameters(bP){
    this.bP = bP;
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

  static async copy(signingAccount, address, inKeys=null, outKeys=null, traverse=false){
    const root = await this.fromCID(signingAccount, address, inKeys);
    return root.copy(inKeys, outKeys, traverse);

    /* When to write this out?
    if(this.#dataRootLabel.length){
      console.log(`setting data entry for ${this.#dataRootLabel}: `, root.cid.toString());
      return this.signingAccount.setDataEntry(this.#dataRootLabel, root.cid.toString());
    }
    */
  }

  static SigningAccount = SigningAccount;

  // linking plaintext depends upon depth first COL_Node.traverse()
  static async publishPlaintext(root, keys, docName=null){
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
  }

  async copy(inKeys=null, outKeys=null, traverse=false){
console.log(`entered instance.copy with `, this, inKeys, outKeys);
    const graphNodes = []; // (hopefully) will use later cleaning cache and local storage
    const linkMap = {};
    const needsReLinking = !!inKeys !== !!outKeys || !!inKeys && !!outKeys && 
                           JSON.stringify(inKeys.reader) !== JSON.stringify(outKeys.writer);
    async function writeNode(node){
      await node.write('', null, false, false);
      graphNodes.push(node);
    }
    async function reWriteNode(node){
      const value = Object.assign({}, node.value);
      const links = Object.entries(node.links);
      if(links.length > 1)
        for(const [name, cid] of links)
          if(!name.endsWith('_last'))
            value[name] = linkMap[cid.toString()].cid;
      console.log(`graphNodes and linkMap are: `, graphNodes, linkMap);
      const ptNode = await new Encrypted_Node(value, node.signingAccount).write('', outKeys, false, false);
      linkMap[node.cid.toString()] = ptNode;
      graphNodes.push(node);
      console.log(`graphNodes and linkMap are: `, graphNodes, linkMap);
    }
    if(traverse)
      if(needsReLinking)
        await Encrypted_Node.traverse(this.cid, reWriteNode, inKeys);
      else
        await Encrypted_Node.traverse(this.cid, writeNode, inKeys);
    else
      writeNode(this);
  }
}

window.Encrypted_Node = Encrypted_Node;

export {Encrypted_Node};