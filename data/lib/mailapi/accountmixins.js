/**
 *
 **/

define(
  [
    'exports'
  ],
  function(
    exports
  ) {

/**
 * @args[
 *   @param[op MailOp]
 *   @param[mode @oneof[
 *     @case['local_do']{
 *       Apply the mutation locally to our database rep.
 *     }
 *     @case['check']{
 *       Check if the manipulation has been performed on the server.  There
 *       is no need to perform a local check because there is no way our
 *       database can be inconsistent in its view of this.
 *     }
 *     @case['do']{
 *       Perform the manipulation on the server.
 *     }
 *     @case['local_undo']{
 *       Undo the mutation locally.
 *     }
 *     @case['undo']{
 *       Undo the mutation on the server.
 *     }
 *   ]]
 *   @param[callback @func[
 *     @args[
 *       @param[error @oneof[String null]]
 *     ]
 *   ]]
 *   }
 * ]
 */
exports.runOp = function runOp(op, mode, callback) {
  console.log('runOp(' + mode + ': ' + JSON.stringify(op).substring(0, 160) +
              ')');

  var methodName = mode + '_' + op.type, self = this;

  if (!(methodName in this._jobDriver)) {
    console.warn('Unsupported op:', op.type, 'mode:', mode);
    callback('failure-give-up');
    return;
  }

  this._LOG.runOp_begin(mode, op.type, null, op);
  // _LOG supports wrapping calls, but we want to be able to strip out all
  // logging, and that wouldn't work.
  try {
    this._jobDriver[methodName](op, function(error, resultIfAny,
                                             accountSaveSuggested) {
      self._jobDriver.postJobCleanup(!error);
      self._LOG.runOp_end(mode, op.type, error, op);
      // defer the callback to the next tick to avoid deep recursion
      window.setZeroTimeout(function() {
        callback(error, resultIfAny, accountSaveSuggested);
      });
    });
  }
  catch (ex) {
    this._LOG.opError(mode, op.type, ex);
  }
};


/**
 * Return the folder metadata for the first folder with the given type, or null
 * if no such folder exists.
 */
exports.getFirstFolderWithType = function(type) {
  var folders = this.folders;
  for (var iFolder = 0; iFolder < folders.length; iFolder++) {
    if (folders[iFolder].type === type)
      return folders[iFolder];
  }
 return null;
};
exports.getFolderByPath = function(folderPath) {
  var folders = this.folders;
  for (var iFolder = 0; iFolder < folders.length; iFolder++) {
    if (folders[iFolder].path === folderPath)
      return folders[iFolder];
  }
 return null;
};



/**
 * Save the state of this account to the database.  This entails updating all
 * of our highly-volatile state (folderInfos which contains counters, accuracy
 * structures, and our block info structures) as well as any dirty blocks.
 *
 * This should be entirely coherent because the structured clone should occur
 * synchronously during this call, but it's important to keep in mind that if
 * that ever ends up not being the case that we need to cause mutating
 * operations to defer until after that snapshot has occurred.
 */
exports.saveAccountState = function(reuseTrans, callback, reason) {
  if (!this._alive) {
    this._LOG.accountDeleted('saveAccountState');
    return null;
  }

  // Indicate save is active, in case something, like
  // signaling the end of a sync, needs to run after
  // a save, via runAfterSaves.
  this._saveAccountStateActive = true;
  if (!this._deferredSaveAccountCalls) {
    this._deferredSaveAccountCalls = [];
  }

  if (callback)
    this.runAfterSaves(callback);

  var perFolderStuff = [], self = this;
  for (var iFolder = 0; iFolder < this.folders.length; iFolder++) {
    var folderPub = this.folders[iFolder],
        folderStorage = this._folderStorages[folderPub.id],
        folderStuff = folderStorage.generatePersistenceInfo();
    if (folderStuff)
      perFolderStuff.push(folderStuff);
  }
  this._LOG.saveAccountState(reason);
  var trans = this._db.saveAccountFolderStates(
    this.id, this._folderInfos, perFolderStuff,
    this._deadFolderIds,
    function stateSaved() {
      this._saveAccountStateActive = false;

      // NB: we used to log when the save completed, but it ended up being
      // annoying to the unit tests since we don't block our actions on
      // the completion of the save at this time.

      var callbacks = this._deferredSaveAccountCalls;
      this._deferredSaveAccountCalls = [];
      callbacks.forEach(function(callback) {
        callback();
      });
    }.bind(this),
    reuseTrans);
  this._deadFolderIds = null;
  return trans;
};

exports.runAfterSaves = function(callback) {
  if (this._saveAccountStateActive || this._saveAccountIsImminent) {
    this._deferredSaveAccountCalls.push(callback);
  } else {
    callback();
  }
};

}); // end define
