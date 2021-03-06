import { ComponentType } from '@angular/cdk/portal';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { AuthorizationService } from '../../../../services/authorization.service';
import { CentralServerService } from '../../../../services/central-server.service';
import { DialogService } from '../../../../services/dialog.service';
import { MessageService } from '../../../../services/message.service';
import { SpinnerService } from '../../../../services/spinner.service';
import { UsersDialogComponent } from '../../../../shared/dialogs/users/users-dialog.component';
import { ChargePointStatus, ChargingStation, ChargingStationButtonAction, Connector, OCPPGeneralResponse } from '../../../../types/ChargingStation';
import { ActionResponse } from '../../../../types/DataResult';
import { ButtonColor, ButtonType, TableActionDef } from '../../../../types/Table';
import { User, UserToken } from '../../../../types/User';
import { Users } from '../../../../utils/Users';
import { Utils } from '../../../../utils/Utils';
import { TableAction } from '../table-action';

export const BUTTON_FOR_MYSELF = 'FOR_MYSELF';
export const BUTTON_SELECT_USER = 'SELECT_USER';

export interface TableChargingStationsStartTransactionActionDef extends TableActionDef {
  action: (chargingStationDialogComponent: ComponentType<unknown>, chargingStation: ChargingStation, connector: Connector,
    authorizationService: AuthorizationService, dialogService: DialogService, dialog: MatDialog, translateService: TranslateService,
    messageService: MessageService, centralServerService: CentralServerService, spinnerService: SpinnerService, router: Router,
    refresh?: () => Observable<void>) => void;
}

export class TableChargingStationsStartTransactionAction implements TableAction {
  private action: TableChargingStationsStartTransactionActionDef = {
    id: ChargingStationButtonAction.START_TRANSACTION,
    type: 'button',
    icon: 'play_arrow',
    color: ButtonColor.ACCENT,
    name: 'general.start',
    tooltip: 'general.tooltips.start',
    action: this.startTransaction.bind(this),
  };

  public getActionDef(): TableChargingStationsStartTransactionActionDef {
    return this.action;
  }

  private startTransaction(chargingStationDialogComponent: ComponentType<unknown>, chargingStation: ChargingStation, connector: Connector, authorizationService: AuthorizationService,
    dialogService: DialogService, dialog: MatDialog, translateService: TranslateService, messageService: MessageService,
    centralServerService: CentralServerService, spinnerService: SpinnerService, router: Router,
    refresh?: () => Observable<void>) {
    if (chargingStation.inactive) {
      dialogService.createAndShowOkDialog(
        translateService.instant('chargers.action_error.transaction_start_title'),
        translateService.instant('chargers.action_error.transaction_start_chargingStation_inactive'));
      return;
    }
    if (connector.status === ChargePointStatus.UNAVAILABLE) {
      dialogService.createAndShowOkDialog(
        translateService.instant('chargers.action_error.transaction_start_title'),
        translateService.instant('chargers.action_error.transaction_start_not_available'));
      return;
    }
    if (connector.currentTransactionID) {
      dialogService.createAndShowOkDialog(
        translateService.instant('chargers.action_error.transaction_start_title'),
        translateService.instant('chargers.action_error.transaction_in_progress'));
      return;
    }
    // Check
    if (authorizationService.isAdmin()) {
      // Create dialog data
      const dialogConfig = new MatDialogConfig();
      dialogConfig.panelClass = '';
      // Set data
      dialogConfig.data = {
        title: 'chargers.start_transaction_admin_title',
        message: 'chargers.start_transaction_admin_message',
      };
      // Show
      const dialogRef = dialog.open(chargingStationDialogComponent, dialogConfig);
      dialogRef.afterClosed().subscribe((buttonId) => {
        switch (buttonId) {
          case BUTTON_FOR_MYSELF:
            return this.startTransactionForUser(chargingStation, connector, null, centralServerService.getLoggedUser(),
              dialogService, translateService, messageService, centralServerService, router, spinnerService, refresh);
          case BUTTON_SELECT_USER:
            // Show select user dialog
            dialogConfig.data = {
              title: 'chargers.start_transaction_user_select_title',
              validateButtonTitle: 'chargers.start_transaction_user_select_button',
              rowMultipleSelection: false,
            };
            dialogConfig.panelClass = 'transparent-dialog-container';
            const dialogRef2 = dialog.open(UsersDialogComponent, dialogConfig);
            // Add sites
            dialogRef2.afterClosed().subscribe((data) => {
              if (data && data.length > 0) {
                return this.startTransactionForUser(chargingStation, connector, data[0].objectRef, centralServerService.getLoggedUser(),
                  dialogService, translateService, messageService, centralServerService, router, spinnerService, refresh);
              }
            });
            break;
        }
      });
    } else {
      this.startTransactionForUser(chargingStation, connector, null, centralServerService.getLoggedUser(),
        dialogService, translateService, messageService, centralServerService, router, spinnerService, refresh);
    }
  }

  private startTransactionForUser(chargingStation: ChargingStation, connector: Connector, user: User | null,
    loggedUser: UserToken, dialogService: DialogService, translateService: TranslateService, messageService: MessageService,
    centralServerService: CentralServerService, router: Router, spinnerService: SpinnerService, refresh?: () => Observable<void>): void {
    dialogService.createAndShowYesNoDialog(
      translateService.instant('chargers.start_transaction_title'),
      translateService.instant('chargers.start_transaction_confirm', {
        chargeBoxID: chargingStation.id,
        userName: Users.buildUserFullName(user ? user : loggedUser),
      }),
    ).subscribe((response) => {
      if (response === ButtonType.YES) {
        // Check badge
        let tagId;
        if (user) {
          if (user.tags.find((value) => value.active === true)) {
            tagId = user.tags.find((value) => value.active === true).id;
          }
        } else if (loggedUser.tagIDs && loggedUser.tagIDs.length > 0) {
          tagId = loggedUser.tagIDs[0];
        }
        if (!tagId) {
          messageService.showErrorMessage(
            translateService.instant('chargers.start_transaction_missing_active_tag', {
              chargeBoxID: chargingStation.id,
              userName: Users.buildUserFullName(user ? user : loggedUser),
            }));
          return;
        }
        spinnerService.show();
        centralServerService.chargingStationStartTransaction(
          chargingStation.id, connector.connectorId, tagId).subscribe((startTransactionResponse: ActionResponse) => {
            spinnerService.hide();
            if (startTransactionResponse.status === OCPPGeneralResponse.ACCEPTED) {
              messageService.showSuccessMessage(
                translateService.instant('chargers.start_transaction_success', { chargeBoxID: chargingStation.id }));
              if (refresh) {
                refresh().subscribe();
              }
            } else {
              Utils.handleError(JSON.stringify(response),
                messageService, translateService.instant('chargers.start_transaction_error'));
            }
          }, (error) => {
            spinnerService.hide();
            Utils.handleHttpError(error, router, messageService, centralServerService, 'chargers.start_transaction_error');
          });
      }
    });
  }
}
