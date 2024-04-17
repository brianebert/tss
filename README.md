# @brianebert/tss
a way **t**o **s**afely and **s**imply use [ipfs](https://github.com/ipfs/ipfs) distributd storage, with distributed message queueing, end to end encryption, and micropayments.

**tss Encrypted_Node**s maintain relations between ipfs ([ipld](https://github.com/ipld/ipld)) data by backlinking to parent nodes and rippling hash changes from leaf node to graph root, using a simple insert(), modify(), and delete() programming interface.

A **tss SigningAccount** encrypts your data with keys derived from your crypto wallet wallet signature, allowing you to safely store it in a public ipfs network.

## Install

1. Add tss to your project using npm:

```shell
npm i tss --save
```

2. require/import it in your JavaScript:

```js
import { Encrypted_Node } from "@brianebert/tss";
const signingAccount = new Encrypted_Node.SigningAccount([account address[, signing key]]) // will ask Freighter if not passed
```
## Test tss

1. Use @brianebert/ttss
```shell
git clone https://github.com/brianebert/ttss.git && cd ttss
```