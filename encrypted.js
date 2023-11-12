import {SigningAccount} from './signing.js';
import {COL_Node} from './cols.js';

// combines SigningAccount keys with COL_Node
class Encrypted_Node extends COL_Node {
  #dataRootLabel; #signingAccount;
  constructor(value, signingAccount, dataRootLabel=null){
    if(!signingAccount instanceof SigningAccount)
      throw new Error(`called Encrypted_Node constructor with signingAccount = `, signingAccount)
    super(value);
    this.#signingAccount = signingAccount;
    if(dataRootLabel)
      this.#dataRootLabel = dataRootLabel;
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
    const root = await SigningAccount.dataEntry(account.account.id, dataRootLabel);
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

  static async persist(account, label, value){
    return account.setDataEntry(label, value);
  }

  // linking plaintext depends upon depth first COL_Node.traverse()
  static async publishPlaintext(root, keys, docName=null){
    const context = this;
    const ptLinks = {}; // .cid of encrypted graph keys plaintext node.cid.toString()
    async function publishBlock(node){
      const ptValue = Object.assign({}, node.value);
      for(const link of Object.keys(node.links))
        if(!link.endsWith('_last'))
          ptValue[link] = ptLinks[node.links[link]];
      const ptNode = await new context(ptValue, node.signingAccount, node.name).write(node.name, null, false);
      ptLinks[node.cid.toString()] = ptNode.cid;
    }
    const ptRoot = await this.traverse(root.cid, publishBlock, keys);
    console.log(`have published plaintext document at `, ptLinks[ptRoot.cid.toString()])
    await this.persist(root.signingAccount, docName, ptLinks[ptRoot.cid.toString()].toString());
    console.log(`${root.signingAccount.account.id} has set ${docName} to ${ptLinks[ptRoot.cid.toString()].toString()}`)
  }
}

export {Encrypted_Node};