const ID = '135243'; // Change to a valid id in your DB
const { begin_transaction, commit, rollback, read, write } = require("../models/concurrency_model.js");

// Case #1:  Concurrent transactions in two or more nodes are reading the same data item
async function concurrencyCase1(isolationLevel) {
  try {
    const conn1 = begin_transaction("node1", isolationLevel); 
    const conn3 = begin_transaction("node3", isolationLevel);

    const [result1, result3] = await Promise.all([
      read(conn1, ID),
      read(conn3, ID)
    ]);

    console.log("Node 1 Read: ", result1);
    console.log("Node 3 Read: ", result3);

    // Commit the read transactions
    await Promise.all([
      commit(conn1),
      commit(conn3)
    ]);

    console.log("Case 1 Complete");
  }
  catch (err) {
    console.log("Error in Case 1: ", err);
  }
}

// Case #2: At least one transaction in the three nodes is writing (update / deletion) and the others are reading the same data item.
async function concurrencyCase2(isolationLevel) {
  try {
    const conn1 = begin_transaction("node1", isolationLevel);
    const conn2 = begin_transaction("node2", isolationLevel);
    const conn3 = begin_transaction("node3", isolationLevel);

    await Promise.all([
      write(conn1, ID, "New Title"),
      read(conn2, ID),
      read(conn3, ID)
    ]);

    await Promise.all([
      commit(conn1),
      commit(conn2),
      commit(conn3)
    ]);

    console.log("Case 2 Complete");
  }
  catch (err) {
    console.log("Error in Case 2", err);
  }

}


// Case #3: Concurrent transactions in two or more nodes are writing (update / deletion) on the same data item.
async function concurrencyCase3(isolationLevel) {
  try {
    const conn1 = begin_transaction("node1", isolationLevel);
    const conn2 = begin_transaction("node2", isolationLevel);
    const conn3 = begin_transaction("node3", isolationLevel);

    await Promise.all([
      write(conn1, ID, "Title from Node 1"),
      write(conn2, ID, "Title from Node 2"),
      write(conn3, ID, "Title from Node 3")
    ]);

    await Promise.all([
      commit(conn1),
      commit(conn2),
      commit(conn3)
    ]);

    console.log("Case 3 Complete");
  }
  catch (err) {
    console.log("Error in Case 3", err);
  }
}